package com.linshe.shell

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 开机自启通知服务（需要用户在系统设置中允许自启动，国产 ROM 尤其如此） */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val prefs = context.getSharedPreferences("shell", Context.MODE_PRIVATE)
        val url = prefs.getString("url", null)
        if (url.isNullOrEmpty() || !SseNotificationService.anyCategoryEnabled(context)) return
        runCatching {
            context.startForegroundService(Intent(context, SseNotificationService::class.java))
        }
    }
}
