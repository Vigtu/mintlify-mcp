"""
Agno server for documentation RAG.

Usage:
    python -m server.main --project my-docs --port 7777
"""

import argparse
import os
from pathlib import Path
from textwrap import dedent

from dotenv import load_dotenv

# Load .env from project root (parent of python/)
load_dotenv(Path(__file__).parent.parent.parent / ".env")

from agno.agent import Agent
from agno.knowledge.embedder.openai import OpenAIEmbedder
from agno.knowledge.knowledge import Knowledge
from agno.models.openai import OpenAIChat
from agno.os import AgentOS
from agno.vectordb.lancedb import LanceDb, SearchType


def create_knowledge(project_id: str, data_dir: Path) -> Knowledge:
    """Create Knowledge with LanceDB vector store."""
    lancedb_path = data_dir / "projects" / project_id / "lancedb"
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


def create_agent(project_id: str, knowledge: Knowledge, model_id: str) -> Agent:
    """Create Agent with knowledge search enabled."""
    return Agent(
        name=f"{project_id}-assistant",
        model=OpenAIChat(id=model_id),
        knowledge=knowledge,
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


def create_agent_os(
    project_id: str,
    data_dir: Path,
    model_id: str = "gpt-4o-mini",
) -> AgentOS:
    """Create AgentOS instance for a project."""
    knowledge = create_knowledge(project_id, data_dir)
    agent = create_agent(project_id, knowledge, model_id)

    return AgentOS(
        id=project_id,
        description=f"Documentation assistant for {project_id}",
        agents=[agent],
        knowledge=[knowledge],
    )


# Initialize at module level using environment variables
# These are set by main() before serve() reimports the module
_project_id = os.environ.get("AGNO_PROJECT_ID")
_data_dir = Path(os.environ.get("AGNO_DATA_DIR", Path.home() / ".mintlify-mcp"))
_model_id = os.environ.get("AGNO_MODEL_ID", "gpt-4o-mini")

if _project_id:
    _agent_os = create_agent_os(_project_id, _data_dir, _model_id)
    app = _agent_os.get_app()
else:
    _agent_os = None
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
    agent_os = create_agent_os(args.project, args.data_dir, args.model)

    # Serve - uvicorn will reimport module and use env vars
    agent_os.serve(
        app="server.main:app",
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
