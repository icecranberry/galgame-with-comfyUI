# 邻舍 ComfyUI 显存守卫

优先运行邻舍的本地语音“安装／修复”，它会根据启动器配置自动安装。
路径无法确定时可在邻舍根目录运行：

```powershell
.\tts-service\install-comfy-guard.ps1 -ComfyRoot 'D:\实际路径\ComfyUI' -ComfyUrl 'http://127.0.0.1:8188'
```

正确位置是 `ComfyUI/custom_nodes/linshe_tts_guard/__init__.py`。
不要覆盖 `ComfyUI/__init__.py`，也不要直接放到 `ComfyUI/comfy_guard`。
等待绘图队列结束后重启 ComfyUI，再从邻舍生成试听。

只读状态接口：`GET /linshe/gpu/status`。不要用 `recover` 探测，它会清除租约。
