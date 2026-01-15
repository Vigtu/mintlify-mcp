"""
Agno server for documentation RAG.

Usage:
    python -m agno.main --project my-docs --port 7777
"""

import argparse
import os
from pathlib import Path
from textwrap import dedent

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


# Global variables for module-level access (required by serve)
_agent_os: AgentOS | None = None
app = None


def initialize(project_id: str, data_dir: Path, model_id: str = "gpt-4o-mini"):
    """Initialize the AgentOS instance."""
    global _agent_os, app
    _agent_os = create_agent_os(project_id, data_dir, model_id)
    app = _agent_os.get_app()
    return _agent_os


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

    print(f"Starting AgentOS for project: {args.project}")
    print(f"  Data dir: {args.data_dir}")
    print(f"  Port: {args.port}")
    print(f"  Model: {args.model}")

    # Initialize AgentOS
    agent_os = initialize(args.project, args.data_dir, args.model)

    # Serve
    agent_os.serve(
        app="agno.main:app",
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
