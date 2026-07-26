package com.linshe.shell

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    companion object {
        private const val PREFS_NAME = "shell"
        private const val KEY_URL = "url"

        /** 通知服务据此判断 App 是否在前台（前台时不弹系统通知） */
        @Volatile
        var inForeground = false
    }

    private lateinit var webView: WebView
    private lateinit var setupPanel: View
    private lateinit var urlInput: EditText
    private lateinit var hintText: TextView

    private val prefs by lazy { getSharedPreferences(PREFS_NAME, MODE_PRIVATE) }

    private val notifyToggleIds = mapOf(
        SseNotificationService.CAT_CHAT to R.id.notifyChat,
        SseNotificationService.CAT_MOMENTS to R.id.notifyMoments,
        SseNotificationService.CAT_COMMENTS to R.id.notifyComments,
        SseNotificationService.CAT_GROUP to R.id.notifyGroup,
        SseNotificationService.CAT_MAILBOX to R.id.notifyMailbox,
        SseNotificationService.CAT_EVENTS to R.id.notifyEvents,
    )

    // <input type="file"> 支持（头像上传等）
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        fileChooserCallback?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        )
        fileChooserCallback = null
    }

    private val notifPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* 拒绝也不阻塞，网页功能不受影响 */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        setupPanel = findViewById(R.id.setupPanel)
        urlInput = findViewById(R.id.urlInput)
        hintText = findViewById(R.id.hintText)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView, request: WebResourceRequest
            ): Boolean {
                val url = request.url.toString()
                if (url.startsWith("http://") || url.startsWith("https://")) return false
                // 非 http 协议（tel:/mailto: 等）交给系统
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }

            override fun onReceivedError(
                view: WebView, request: WebResourceRequest, error: WebResourceError
            ) {
                if (request.isForMainFrame) {
                    showSetup("无法连接：${error.description}\n请确认地址正确且服务已启动")
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = callback
                return try {
                    fileChooserLauncher.launch(params.createIntent())
                    true
                } catch (e: Exception) {
                    fileChooserCallback = null
                    false
                }
            }
        }

        findViewById<TextView>(R.id.hideServiceNotifyBtn).setOnClickListener {
            // 跳到「后台连接」渠道的系统设置页，用户关掉即可隐藏常驻通知（服务不受影响）
            SseNotificationService.ensureChannels(this)
            runCatching {
                startActivity(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                    putExtra(Settings.EXTRA_CHANNEL_ID, SseNotificationService.SERVICE_CHANNEL_ID)
                })
            }
        }

        findViewById<TextView>(R.id.goBackgroundSettingsBtn).setOnClickListener {
            // 应用详情页：后台权限（无限制）、自启动、电池策略都在这里设置
            runCatching {
                startActivity(Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:$packageName")
                ))
            }
        }

        findViewById<Button>(R.id.saveBtn).setOnClickListener {
            var url = urlInput.text.toString().trim()
            if (url.isEmpty()) return@setOnClickListener
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                url = "http://$url"
            }
            val editor = prefs.edit().putString(KEY_URL, url)
            for ((cat, id) in notifyToggleIds) {
                editor.putBoolean("notify_$cat", findViewById<CheckBox>(id).isChecked)
            }
            editor.apply()
            syncNotificationService(interactive = true)
            showWeb()
            webView.loadUrl(url)
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val savedUrl = prefs.getString(KEY_URL, null)
                when {
                    // 设置页按返回：已有保存地址则回到网页
                    setupPanel.visibility == View.VISIBLE && savedUrl != null
                            && webView.url != null -> showWeb()
                    webView.visibility == View.VISIBLE && webView.canGoBack() -> webView.goBack()
                    else -> confirmExit()
                }
            }
        })

        val savedUrl = prefs.getString(KEY_URL, null)
        val initialRoute = intent?.getStringExtra("route")
        intent?.removeExtra("route")
        if (savedUrl != null) {
            showWeb()
            // 冷启动带路由（点通知拉起）：直接加载目标页，避免先加载首页再跳转
            val target = if (initialRoute != null)
                savedUrl.trimEnd('/') + "/#" + initialRoute
            else savedUrl
            webView.loadUrl(target)
            syncNotificationService()
        } else {
            showSetup(null)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleRoute(intent)
    }

    /** 通知点击 → 跳转对应页面（hash 路由） */
    private fun handleRoute(intent: Intent?) {
        val route = intent?.getStringExtra("route") ?: return
        intent.removeExtra("route")
        val base = prefs.getString(KEY_URL, null) ?: return
        showWeb()
        val current = webView.url
        if (current != null && current.startsWith(base.trimEnd('/'))) {
            // SPA 已加载：原地改 hash 触发 vue-router 跳转，避免整页刷新
            webView.evaluateJavascript("window.location.hash = '#$route';", null)
        } else {
            webView.loadUrl(base.trimEnd('/') + "/#" + route)
        }
    }

    override fun onResume() {
        super.onResume()
        inForeground = true
    }

    override fun onPause() {
        inForeground = false
        super.onPause()
    }

    // ── 通知服务管理 ──

    /**
     * @param interactive 仅在用户主动操作（点保存）时为 true，此时才弹权限/白名单请求；
     *                    App 启动时静默启停服务，避免拒绝过的用户每次打开都被弹窗骚扰
     */
    private fun syncNotificationService(interactive: Boolean = false) {
        val intent = Intent(this, SseNotificationService::class.java)
        val url = prefs.getString(KEY_URL, null)
        if (url != null && SseNotificationService.anyCategoryEnabled(this)) {
            if (interactive) {
                if (Build.VERSION.SDK_INT >= 33 &&
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED
                ) {
                    notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
                requestBatteryExemption()
            }
            startForegroundService(intent)
        } else {
            stopService(intent)
        }
    }

    /** 引导用户把 App 加入电池优化白名单，否则锁屏后 SSE 连接会被 Doze 掐断 */
    @SuppressLint("BatteryLife")
    private fun requestBatteryExemption() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            runCatching {
                startActivity(
                    Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:$packageName")
                    )
                )
            }
        }
    }

    // ── 视图切换 ──

    private fun showWeb() {
        setupPanel.visibility = View.GONE
        webView.visibility = View.VISIBLE
    }

    private fun showSetup(error: String?) {
        urlInput.setText(prefs.getString(KEY_URL, "") ?: "")
        for ((cat, id) in notifyToggleIds) {
            findViewById<CheckBox>(id).isChecked =
                prefs.getBoolean("notify_$cat", SseNotificationService.defaultFor(cat))
        }
        hintText.text = error ?: getString(R.string.setup_hint)
        webView.visibility = View.GONE
        setupPanel.visibility = View.VISIBLE
    }

    private fun confirmExit() {
        AlertDialog.Builder(this)
            .setMessage(R.string.exit_confirm)
            .setPositiveButton(R.string.exit) { _, _ -> finish() }
            .setNegativeButton(R.string.change_url) { _, _ -> showSetup(null) }
            .setNeutralButton(R.string.cancel, null)
            .show()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
