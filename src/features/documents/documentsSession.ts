import { useSyncExternalStore } from 'react';
import { BrowserDocumentService } from './BrowserDocumentService.ts';
import { DOC_SERVER_URL } from './config.ts';
import { DocumentLibrary } from './DocumentLibrary.ts';
import type { DocumentService } from './DocumentService.ts';
import { ServerDocumentService } from './ServerDocumentService.ts';
import { UploadQueue } from './UploadQueue.ts';

/** App-wide document services: the server when configured, otherwise this browser only. */
export const documentService: DocumentService = DOC_SERVER_URL ? new ServerDocumentService(DOC_SERVER_URL) : new BrowserDocumentService();
export const documentLibrary = new DocumentLibrary(documentService);
export const uploadQueue = new UploadQueue(documentService, documentLibrary);

export const useDocumentLibrary = () => useSyncExternalStore(documentLibrary.subscribe, documentLibrary.getSnapshot);
export const useUploads = () => useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getSnapshot);
