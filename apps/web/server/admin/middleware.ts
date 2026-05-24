import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { handleInjectMessage } from "./injectMessage";

type Next = (err?: unknown) => void;

function pathOf(req: IncomingMessage): string | null {
  try {
    return new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    return null;
  }
}

async function handleAdminApi(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
  if (pathOf(req) !== "/api/admin/inject-message") {
    next();
    return;
  }

  try {
    await handleInjectMessage(req, res);
  } catch (err) {
    next(err);
  }
}

export function adminApiPlugin(): Plugin {
  return {
    name: "clan-world-admin-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleAdminApi(req, res, next);
      });
    },
    configurePreviewServer(server) {
      // TODO(production): hosted cockpit deployment needs a Node adapter or
      // Vercel function equivalent for /api/admin/*.
      server.middlewares.use((req, res, next) => {
        void handleAdminApi(req, res, next);
      });
    },
  };
}
