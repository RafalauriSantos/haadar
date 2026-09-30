export interface Env {
  DB?: D1Database;
}

const worker = {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === "/health") {
      return Response.json({ service: "haadar", status: "ok" });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {}
};

export default worker;
