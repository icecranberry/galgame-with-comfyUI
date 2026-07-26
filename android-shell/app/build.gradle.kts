plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.linshe.shell"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.linshe.shell"
        minSdk = 26
        targetSdk = 34
        versionCode = 8
        versionName = "1.7"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // 自用分发，直接用 debug 签名保证可安装
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    lint {
        // 自用壳应用，lint 问题不阻塞 release 构建
        checkReleaseBuilds = false
        abortOnError = false
    }
}

// 同步应用图标：android-shell/app-icon.png|jpg → res/drawable-nodpi/ic_launcher_image.*
// 放在 gradle 层保证 npm run apk 与 Android Studio 两条构建路径都生效（res 内为派生产物，不入库）
val syncAppIcon = tasks.register("syncAppIcon") {
    doLast {
        val src = listOf("png", "jpg")
            .map { File(rootProject.projectDir, "app-icon.$it") }
            .firstOrNull { it.exists() }
        val resDir = File(projectDir, "src/main/res/drawable-nodpi")
        if (src != null) {
            resDir.mkdirs()
            src.copyTo(File(resDir, "ic_launcher_image.${src.extension}"), overwrite = true)
            val stale = File(resDir, "ic_launcher_image.${if (src.extension == "jpg") "png" else "jpg"}")
            if (stale.exists()) stale.delete()
        } else if (!File(resDir, "ic_launcher_image.png").exists() &&
            !File(resDir, "ic_launcher_image.jpg").exists()
        ) {
            throw GradleException("缺少应用图标：请在 android-shell/ 下放置 app-icon.png 或 app-icon.jpg")
        }
    }
}
tasks.named("preBuild") { dependsOn(syncAppIcon) }

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
}
