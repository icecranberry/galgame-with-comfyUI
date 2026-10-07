package com.linshe.shell

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlin.math.atan2
import kotlin.math.exp
import kotlin.math.hypot

/** Main-thread only. Gravity is sufficient for small tilts; no compass or runtime permission. */
internal class StandingGravitySensor(
    context: Context,
    private val allowed: () -> Boolean,
    private val publish: (session: String, beta: Double, gamma: Double) -> Unit,
) : SensorEventListener {
    private val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val sensor = manager.getDefaultSensor(Sensor.TYPE_GRAVITY)
        ?: manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    val supported: Boolean get() = sensor != null
    private var session: String? = null
    private var lastSample = 0L
    private var lastPublish = 0L
    private val gravity = DoubleArray(3)

    fun start(token: String): Boolean {
        stop()
        if (!allowed() || sensor == null) return false
        session = token
        val registered = manager.registerListener(this, sensor, 33_333)
        if (!registered) stop()
        return registered
    }

    fun stop(token: String? = null) {
        if (token != null && token != session) return
        manager.unregisterListener(this)
        session = null
        lastSample = 0L
        lastPublish = 0L
    }

    override fun onSensorChanged(event: SensorEvent) {
        val token = session ?: return
        if (!allowed()) { stop(); return }
        if (event.values.size < 3 || (0..2).any { !event.values[it].isFinite() }) return
        // Older phones may only have an accelerometer: remove short hand-shake spikes.
        val alpha = if (lastSample == 0L || sensor?.type != Sensor.TYPE_ACCELEROMETER) 1.0
            else 1.0 - exp(-(event.timestamp - lastSample).coerceAtLeast(0L) / 150_000_000.0)
        for (i in 0..2) gravity[i] += alpha * (event.values[i] - gravity[i])
        lastSample = event.timestamp
        if (lastPublish != 0L && event.timestamp - lastPublish < 33_333_333L) return
        val x = gravity[0]; val y = gravity[1]; val z = gravity[2]
        if (hypot(x, hypot(y, z)) < 1.0) return
        lastPublish = event.timestamp
        // Android gravity axes -> the beta/gamma convention consumed by the web view.
        publish(token, Math.toDegrees(atan2(y, z)), Math.toDegrees(atan2(-x, hypot(y, z))))
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
