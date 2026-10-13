"""Copy this directory into ComfyUI/custom_nodes/linshe_tts_guard.

A lease blocks *all* HTTP prompt submissions until the Node coordinator has
confirmed TTS worker termination. No unsafe TTL expiry while CUDA may be alive.
"""
import asyncio
from aiohttp import web
from server import PromptServer
import comfy.model_management as mm

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
lease = None
submissions = 0


@web.middleware
async def protect_prompts(request, handler):
    global submissions
    if request.method == "POST" and request.path.rstrip("/") in ("/prompt", "/api/prompt"):
        if lease is not None:
            return web.json_response({"error": "邻舍正在合成语音，请稍后重试"}, status=423)
        submissions += 1
        try:
            return await handler(request)
        finally:
            submissions -= 1
    return await handler(request)


PromptServer.instance.app.middlewares.append(protect_prompts)


@PromptServer.instance.routes.post("/linshe/gpu/acquire")
async def acquire(request):
    global lease
    body = await request.json()
    token = body.get("token")
    if not isinstance(token, str) or not 1 <= len(token) <= 100:
        return web.json_response({"error": "Invalid token"}, status=400)
    # Count requests across asynchronous prompt validation as well as the queue.
    running, pending = PromptServer.instance.prompt_queue.get_current_queue()
    if lease is not None or submissions or running or pending:
        return web.json_response({"busy": True}, status=409)
    lease = token
    try:
        await asyncio.to_thread(mm.unload_all_models)
        await asyncio.to_thread(mm.soft_empty_cache)
        return web.json_response({"acquired": True})
    except Exception as error:
        lease = None
        return web.json_response({"error": str(error)}, status=500)


@PromptServer.instance.routes.post("/linshe/gpu/release")
async def release(request):
    global lease
    body = await request.json()
    if lease != body.get("token"):
        return web.json_response({"error": "Lease mismatch"}, status=409)
    lease = None
    return web.json_response({"released": True})


@PromptServer.instance.routes.post("/linshe/gpu/recover")
async def recover(request):
    global lease
    # Called only after Node receives confirmed /unload from the worker service.
    body = await request.json()
    if body.get("worker_unloaded") is not True:
        return web.json_response({"error": "Worker exit required"}, status=400)
    lease = None
    return web.json_response({"released": True})
