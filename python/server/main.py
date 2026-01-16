"""
Agno server for documentation RAG.

Usage:
    python -m server.main --project my-docs --port 7777
"""

import argparse
import os
from pathlib import Path
from textwrap import dedent
from typing import Optional

from dotenv import load_dotenv

# Load .env from project root (parent of python/)
load_dotenv(Path(__file__).parent.parent.parent / ".env")

from agno.agent import Agent
from agno.knowledge.embedder.openai import OpenAIEmbedder
from agno.knowledge.knowledge import Knowledge
from agno.models.openai import OpenAIChat
from agno.os import AgentOS
from agno.vectordb.lancedb import LanceDb, SearchType
from fastapi import HTTPException
from pydantic import BaseModel


def create_knowledge(project_id: str, data_dir: Path) -> Knowledge:
    """Create Knowledge with LanceDB vector store (no contents_db for simplicity)."""
    project_dir = data_dir / "projects" / project_id
    lancedb_path = project_dir / "lancedb"
    lancedb_path.mkdir(parents=True, exist_ok=True)

    return Knowledge(
        name=f"{project_id}-docs",
        description=f"Documentation knowledge base for {project_id}",
        vector_db=LanceDb(
            table_name="docs",
            uri=str(lancedb_path),
            search_type=SearchType.hybrid,
            embedder=OpenAIEmbedder(id="text-embedding-3-small"),
        ),
    )


import json as _json

# LanceDB hybrid search returns _relevance_score (higher = better)
# Typical range is ~0.01-0.02 for relevant results
# Set threshold to filter out very low relevance results
MIN_SCORE = 0.015  # Minimum relevance score threshold (balanced: ~5-8 results)


def create_knowledge_retriever(knowledge: Knowledge):
    """Create a custom knowledge retriever with score filtering and clean metadata.

    This bypasses Knowledge.search() to access raw LanceDB results with _score column.
    LanceDB hybrid search returns _score (higher = better).
    """

    async def knowledge_retriever(
        agent: Agent, query: str, num_documents: Optional[int] = None, **kwargs
    ) -> Optional[list[dict]]:
        """Search knowledge base, filter by score, and return results with cleaned metadata."""
        num_docs = num_documents or 10

        # Access the vector_db directly to get raw results with scores
        vector_db = knowledge.vector_db
        if vector_db is None:
            return None

        # Use hybrid_search directly to get pandas DataFrame with _score
        try:
            raw_results = vector_db.hybrid_search(query=query, limit=num_docs * 2)
        except Exception as e:
            print(f"[DEBUG] hybrid_search error: {e}, falling back to knowledge.search()", flush=True)
            # Fallback to normal search without score filtering
            results = knowledge.search(query=query, max_results=num_docs)
            if not results:
                return None
            return [
                {
                    "name": doc.name,
                    "content": doc.content,
                    "meta_data": {
                        k: v for k, v in (doc.meta_data or {}).items() if k not in ("chunk", "chunk_size", "path")
                    },
                }
                for doc in results[:num_docs]
            ]

        if raw_results is None or raw_results.empty:
            return None

        # Determine score column name (LanceDB hybrid search uses _relevance_score)
        score_col = None
        for col in ["_relevance_score", "_score", "_distance"]:
            if col in raw_results.columns:
                score_col = col
                break

        # Debug: show score info
        if score_col:
            scores = raw_results[score_col]
            print(
                f"[DEBUG] {score_col} range: min={scores.min():.6f}, max={scores.max():.6f}, mean={scores.mean():.6f}",
                flush=True,
            )

            # For _distance, lower is better; for _score/_relevance_score, higher is better
            if score_col == "_distance":
                # Convert distance to score (invert)
                max_dist = scores.max()
                if max_dist > 0:
                    raw_results["_norm_score"] = 1 - (scores / max_dist)
                    filtered_df = raw_results[raw_results["_norm_score"] >= MIN_SCORE]
                else:
                    filtered_df = raw_results
            else:
                # Higher is better
                filtered_df = raw_results[raw_results[score_col] >= MIN_SCORE]

            print(
                f"[DEBUG] After score filter (>= {MIN_SCORE}): {len(filtered_df)} / {len(raw_results)} results",
                flush=True,
            )
        else:
            filtered_df = raw_results
            print(f"[DEBUG] No score column found, using all {len(raw_results)} results", flush=True)

        if filtered_df.empty:
            return None

        # Build results with deduplication
        seen_urls: dict[str, int] = {}
        final_results = []

        for _, row in filtered_df.iterrows():
            if len(final_results) >= num_docs:
                break

            payload = _json.loads(row["payload"])
            source_url = (payload.get("meta_data") or {}).get("source_url", payload.get("name", ""))

            # Max 2 chunks per source URL
            if seen_urls.get(source_url, 0) >= 2:
                continue
            seen_urls[source_url] = seen_urls.get(source_url, 0) + 1

            # Clean metadata - remove internal fields
            meta = payload.get("meta_data") or {}
            cleaned_meta = {k: v for k, v in meta.items() if k not in ("chunk", "chunk_size", "path")}

            final_results.append(
                {
                    "name": payload.get("name", ""),
                    "content": payload.get("content", ""),
                    "meta_data": cleaned_meta,
                }
            )

        print(f"[DEBUG] Final results after dedup: {len(final_results)}", flush=True)
        return final_results if final_results else None

    return knowledge_retriever


def create_agent(project_id: str, knowledge: Knowledge, model_id: str) -> Agent:
    """Create Agent with knowledge search enabled."""
    return Agent(
        name=f"{project_id}-assistant",
        model=OpenAIChat(id=model_id),
        knowledge=knowledge,
        knowledge_retriever=create_knowledge_retriever(knowledge),
        search_knowledge=True,
        tool_call_limit=3,
        instructions=dedent(f"""\
            You are a helpful documentation assistant for {project_id}.
            Search the knowledge base to answer questions about the documentation.
            Always cite sources with URLs when available.
            If you cannot find relevant information, say so clearly.
        """),
        markdown=True,
    )


# =============================================================================
# Custom /seed endpoint - bypasses AgentOS REST API complexity
# =============================================================================


class SeedRequest(BaseModel):
    """Request body for /seed endpoint."""

    name: str
    text_content: str
    metadata: Optional[str] = None  # JSON string


class SeedResponse(BaseModel):
    """Response for /seed endpoint."""

    success: bool
    message: str


def create_agent_os(
    project_id: str,
    data_dir: Path,
    model_id: str = "gpt-4o-mini",
) -> tuple[AgentOS, Knowledge]:
    """Create AgentOS instance for a project. Returns (agent_os, knowledge)."""
    from fastapi import FastAPI

    knowledge = create_knowledge(project_id, data_dir)
    agent = create_agent(project_id, knowledge, model_id)

    # Create custom FastAPI app with /seed endpoint BEFORE AgentOS
    base_app = FastAPI()

    @base_app.post("/seed", response_model=SeedResponse)
    async def seed_content(request: SeedRequest) -> SeedResponse:
        """Add content to knowledge base using SDK directly."""
        try:
            # Parse metadata JSON if provided
            meta_data = None
            if request.metadata:
                import json

                meta_data = json.loads(request.metadata)

            await knowledge.add_content_async(
                name=request.name,
                text_content=request.text_content,
                metadata=meta_data,
            )
            return SeedResponse(success=True, message=f"Added: {request.name}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # Pass custom app to AgentOS - it will merge routes
    agent_os = AgentOS(
        id=project_id,
        description=f"Documentation assistant for {project_id}",
        agents=[agent],
        knowledge=[knowledge],
        base_app=base_app,
    )

    return agent_os, knowledge


# Initialize at module level using environment variables
# These are set by main() before serve() reimports the module
_project_id = os.environ.get("AGNO_PROJECT_ID")
_data_dir = Path(os.environ.get("AGNO_DATA_DIR", Path.home() / ".mintlify-mcp"))
_model_id = os.environ.get("AGNO_MODEL_ID", "gpt-4o-mini")

if _project_id:
    _agent_os, _knowledge = create_agent_os(_project_id, _data_dir, _model_id)
    app = _agent_os.get_app()
else:
    _agent_os = None
    _knowledge = None
    app = None


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Agno server for documentation RAG")
    parser.add_argument(
        "--project",
        "-p",
        required=True,
        help="Project ID",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=7777,
        help="Port to serve on (default: 7777)",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path.home() / ".mintlify-mcp",
        help="Data directory (default: ~/.mintlify-mcp)",
    )
    parser.add_argument(
        "--model",
        default="gpt-4o-mini",
        help="OpenAI model ID (default: gpt-4o-mini)",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload for development",
    )

    args = parser.parse_args()

    # Validate OPENAI_API_KEY
    if not os.environ.get("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY environment variable is required")
        exit(1)

    # Set environment variables for module-level initialization
    os.environ["AGNO_PROJECT_ID"] = args.project
    os.environ["AGNO_DATA_DIR"] = str(args.data_dir)
    os.environ["AGNO_MODEL_ID"] = args.model

    print(f"Starting AgentOS for project: {args.project}")
    print(f"  Data dir: {args.data_dir}")
    print(f"  Port: {args.port}")
    print(f"  Model: {args.model}")

    # Create AgentOS for initial run (before serve reimports)
    agent_os, _ = create_agent_os(args.project, args.data_dir, args.model)

    # Serve - uvicorn will reimport module and use env vars
    agent_os.serve(
        app="server.main:app",
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
