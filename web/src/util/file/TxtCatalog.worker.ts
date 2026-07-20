/// <reference lib="webworker" />

import { createTxtCatalogWorkerService } from './TxtCatalogWorkerService';
import type {
  TxtCatalogWorkerRequest,
  TxtCatalogWorkerResponse,
} from './TxtCatalogWorkerProtocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const service = createTxtCatalogWorkerService((progress) => {
  scope.postMessage(progress);
});

scope.addEventListener(
  'message',
  (event: MessageEvent<TxtCatalogWorkerRequest>) => {
    const request = event.data;
    try {
      const result = service.handle(request);
      const response: TxtCatalogWorkerResponse = {
        type: 'result',
        requestId: request.requestId,
        result,
      };
      scope.postMessage(response);
    } catch (error) {
      const response: TxtCatalogWorkerResponse = {
        type: 'error',
        requestId: request.requestId,
        message: error instanceof Error ? error.message : String(error),
      };
      scope.postMessage(response);
    }
  },
);
