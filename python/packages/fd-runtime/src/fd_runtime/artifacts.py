"""Artifact storage for FerrumDeck runs.

Provides a unified interface for storing and retrieving artifacts
(files, logs, outputs) associated with runs and steps.
"""

import hashlib
import json
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any, BinaryIO

logger = logging.getLogger(__name__)


class ArtifactType(Enum):
    """Types of artifacts that can be stored."""

    FILE = "file"
    LOG = "log"
    OUTPUT = "output"
    TRACE = "trace"
    SNAPSHOT = "snapshot"


@dataclass
class ArtifactMetadata:
    """Metadata for a stored artifact."""

    artifact_id: str
    run_id: str
    step_id: str | None
    artifact_type: ArtifactType
    name: str
    size_bytes: int
    content_type: str
    checksum: str
    created_at: datetime
    metadata: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "artifact_id": self.artifact_id,
            "run_id": self.run_id,
            "step_id": self.step_id,
            "artifact_type": self.artifact_type.value,
            "name": self.name,
            "size_bytes": self.size_bytes,
            "content_type": self.content_type,
            "checksum": self.checksum,
            "created_at": self.created_at.isoformat(),
            "metadata": self.metadata,
        }


class ArtifactStore(ABC):
    """Abstract base class for artifact storage."""

    @abstractmethod
    async def store(
        self,
        run_id: str,
        name: str,
        content: bytes | BinaryIO,
        artifact_type: ArtifactType = ArtifactType.FILE,
        step_id: str | None = None,
        content_type: str = "application/octet-stream",
        metadata: dict[str, Any] | None = None,
    ) -> ArtifactMetadata:
        """Store an artifact."""
        ...

    @abstractmethod
    async def retrieve(
        self,
        run_id: str,
        artifact_id: str,
    ) -> tuple[bytes, ArtifactMetadata]:
        """Retrieve an artifact by ID."""
        ...

    @abstractmethod
    async def list_artifacts(
        self,
        run_id: str,
        step_id: str | None = None,
        artifact_type: ArtifactType | None = None,
    ) -> list[ArtifactMetadata]:
        """List artifacts for a run."""
        ...

    @abstractmethod
    async def delete(
        self,
        run_id: str,
        artifact_id: str,
    ) -> bool:
        """Delete an artifact."""
        ...


class LocalFilesystemStore(ArtifactStore):
    """Local filesystem artifact storage.

    Directory structure:
        {base_path}/
            {run_id}/
                artifacts/
                    {artifact_id}/
                        content
                        metadata.json
    """

    def __init__(self, base_path: str | None = None):
        self.base_path = Path(base_path or os.getenv("FD_ARTIFACTS_PATH", "./artifacts"))
        self.base_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Artifact store initialized at {self.base_path}")

    def _run_path(self, run_id: str) -> Path:
        """Get the path for a run's artifacts."""
        return self.base_path / run_id / "artifacts"

    def _artifact_path(self, run_id: str, artifact_id: str) -> Path:
        """Get the path for a specific artifact."""
        return self._run_path(run_id) / artifact_id

    def _generate_artifact_id(self, run_id: str, name: str, step_id: str | None) -> str:
        """Generate a unique artifact ID."""
        timestamp = datetime.now(tz=UTC).isoformat()
        components = [run_id, step_id or "run", name, timestamp]
        hash_input = ":".join(components).encode()
        return hashlib.sha256(hash_input).hexdigest()[:16]

    async def store(
        self,
        run_id: str,
        name: str,
        content: bytes | BinaryIO,
        artifact_type: ArtifactType = ArtifactType.FILE,
        step_id: str | None = None,
        content_type: str = "application/octet-stream",
        metadata: dict[str, Any] | None = None,
    ) -> ArtifactMetadata:
        """Store an artifact to local filesystem."""
        # Read content if it's a file-like object
        content_bytes: bytes = (
            content.read() if hasattr(content, "read") else content  # type: ignore[union-attr,assignment]
        )

        # Generate artifact ID
        artifact_id = self._generate_artifact_id(run_id, name, step_id)
        artifact_dir = self._artifact_path(run_id, artifact_id)
        artifact_dir.mkdir(parents=True, exist_ok=True)

        # Calculate checksum
        checksum = hashlib.sha256(content_bytes).hexdigest()

        # Write content
        content_path = artifact_dir / "content"
        with content_path.open("wb") as f:
            f.write(content_bytes)

        # Create metadata
        artifact_metadata = ArtifactMetadata(
            artifact_id=artifact_id,
            run_id=run_id,
            step_id=step_id,
            artifact_type=artifact_type,
            name=name,
            size_bytes=len(content_bytes),
            content_type=content_type,
            checksum=checksum,
            created_at=datetime.now(tz=UTC),
            metadata=metadata or {},
        )

        # Write metadata
        metadata_path = artifact_dir / "metadata.json"
        with metadata_path.open("w") as f:
            json.dump(artifact_metadata.to_dict(), f, indent=2)

        logger.debug(f"Stored artifact {artifact_id} for run {run_id}")
        return artifact_metadata

    async def retrieve(
        self,
        run_id: str,
        artifact_id: str,
    ) -> tuple[bytes, ArtifactMetadata]:
        """Retrieve an artifact from local filesystem."""
        artifact_dir = self._artifact_path(run_id, artifact_id)

        if not artifact_dir.exists():
            raise FileNotFoundError(f"Artifact {artifact_id} not found for run {run_id}")

        # Read content
        content_path = artifact_dir / "content"
        with content_path.open("rb") as f:
            content = f.read()

        # Read metadata
        metadata_path = artifact_dir / "metadata.json"
        with metadata_path.open() as f:
            raw_metadata = json.load(f)

        metadata = ArtifactMetadata(
            artifact_id=raw_metadata["artifact_id"],
            run_id=raw_metadata["run_id"],
            step_id=raw_metadata.get("step_id"),
            artifact_type=ArtifactType(raw_metadata["artifact_type"]),
            name=raw_metadata["name"],
            size_bytes=raw_metadata["size_bytes"],
            content_type=raw_metadata["content_type"],
            checksum=raw_metadata["checksum"],
            created_at=datetime.fromisoformat(raw_metadata["created_at"]),
            metadata=raw_metadata.get("metadata", {}),
        )

        return content, metadata

    async def list_artifacts(
        self,
        run_id: str,
        step_id: str | None = None,
        artifact_type: ArtifactType | None = None,
    ) -> list[ArtifactMetadata]:
        """List artifacts for a run."""
        run_path = self._run_path(run_id)

        if not run_path.exists():
            return []

        artifacts = []
        for artifact_dir in run_path.iterdir():
            if not artifact_dir.is_dir():
                continue

            metadata_path = artifact_dir / "metadata.json"
            if not metadata_path.exists():
                continue

            with metadata_path.open() as f:
                raw_metadata = json.load(f)

            # Filter by step_id if specified
            if step_id is not None and raw_metadata.get("step_id") != step_id:
                continue

            # Filter by artifact_type if specified
            if artifact_type is not None and raw_metadata["artifact_type"] != artifact_type.value:
                continue

            artifacts.append(
                ArtifactMetadata(
                    artifact_id=raw_metadata["artifact_id"],
                    run_id=raw_metadata["run_id"],
                    step_id=raw_metadata.get("step_id"),
                    artifact_type=ArtifactType(raw_metadata["artifact_type"]),
                    name=raw_metadata["name"],
                    size_bytes=raw_metadata["size_bytes"],
                    content_type=raw_metadata["content_type"],
                    checksum=raw_metadata["checksum"],
                    created_at=datetime.fromisoformat(raw_metadata["created_at"]),
                    metadata=raw_metadata.get("metadata", {}),
                )
            )

        # Sort by creation time
        artifacts.sort(key=lambda a: a.created_at)
        return artifacts

    async def delete(
        self,
        run_id: str,
        artifact_id: str,
    ) -> bool:
        """Delete an artifact from local filesystem."""
        import shutil

        artifact_dir = self._artifact_path(run_id, artifact_id)

        if not artifact_dir.exists():
            return False

        shutil.rmtree(artifact_dir)
        logger.debug(f"Deleted artifact {artifact_id} for run {run_id}")
        return True


def create_artifact_store(store_type: str = "local", **kwargs: Any) -> ArtifactStore:
    """Factory function to create an artifact store.

    Args:
        store_type: Type of store ("local", future: "s3", "gcs")
        **kwargs: Store-specific configuration

    Returns:
        An ArtifactStore instance
    """
    if store_type == "local":
        return LocalFilesystemStore(**kwargs)
    else:
        raise ValueError(f"Unknown artifact store type: {store_type}")
