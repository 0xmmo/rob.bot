export interface TextChunk {
  text: string;
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  source: string;
  page: number;
  filePath: string;
}

export interface ExtractedDocument {
  source: string;
  filePath: string;
  pages: PageContent[];
}

export interface PageContent {
  pageNumber: number;
  text: string;
}

export interface DocumentVectors {
  source: string;
  filePath: string;
  chunks: StoredChunk[];
}

export interface StoredChunk {
  text: string;
  vector: number[];
  metadata: ChunkMetadata;
}

export interface ManifestEntry {
  hash: string;
  chunkCount: number;
  vectorFile: string;
  embeddingModel: string;
  chunkingStrategy: string;
  mtime: number;
  size: number;
  imageHashPrefix: string;
}

export interface Manifest {
  [filePath: string]: ManifestEntry;
}

export interface RetrievedChunk {
  text: string;
  metadata: ChunkMetadata;
  score: number;
}
