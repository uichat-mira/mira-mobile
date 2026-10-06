package io.tomz.mira.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class MiraSecureCredentialStoreModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val preferences = reactContext.getSharedPreferences(
    PREFERENCES_NAME,
    Context.MODE_PRIVATE,
  )

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun get(service: String, promise: Promise) {
    try {
      val keyId = keyId(service)
      val ivValue = preferences.getString("$keyId.iv", null)
      val encryptedValue = preferences.getString("$keyId.value", null)
      if (ivValue == null || encryptedValue == null) {
        promise.resolve(null)
        return
      }

      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(
        Cipher.DECRYPT_MODE,
        getOrCreateKey(),
        GCMParameterSpec(GCM_TAG_LENGTH_BITS, Base64.decode(ivValue, Base64.NO_WRAP)),
      )
      cipher.updateAAD(service.toByteArray(StandardCharsets.UTF_8))
      val plaintext = cipher.doFinal(Base64.decode(encryptedValue, Base64.NO_WRAP))
      promise.resolve(String(plaintext, StandardCharsets.UTF_8))
    } catch (error: Exception) {
      promise.reject(
        "SECURE_CREDENTIAL_READ_FAILED",
        "Unable to read the Mira device credential",
        error,
      )
    }
  }

  @ReactMethod
  fun set(service: String, value: String, promise: Promise) {
    if (service.isBlank()) {
      promise.reject(
        "SECURE_CREDENTIAL_INVALID_SERVICE",
        "Credential service name cannot be empty",
      )
      return
    }

    try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
      cipher.updateAAD(service.toByteArray(StandardCharsets.UTF_8))
      val encrypted = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
      val keyId = keyId(service)
      val saved = preferences.edit()
        .putString("$keyId.iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
        .putString("$keyId.value", Base64.encodeToString(encrypted, Base64.NO_WRAP))
        .commit()

      if (!saved) {
        promise.reject(
          "SECURE_CREDENTIAL_WRITE_FAILED",
          "Unable to persist the Mira device credential",
        )
        return
      }
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject(
        "SECURE_CREDENTIAL_WRITE_FAILED",
        "Unable to persist the Mira device credential",
        error,
      )
    }
  }

  @ReactMethod
  fun randomBytes(length: Int, promise: Promise) {
    if (length < 1 || length > 1024) {
      promise.reject(
        "SECURE_RANDOM_INVALID_LENGTH",
        "Secure random byte length must be between 1 and 1024",
      )
      return
    }

    try {
      val bytes = ByteArray(length)
      SecureRandom().nextBytes(bytes)
      promise.resolve(
        Base64.encodeToString(
          bytes,
          Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
        ),
      )
    } catch (error: Exception) {
      promise.reject(
        "SECURE_RANDOM_FAILED",
        "Unable to generate secure random bytes",
        error,
      )
    }
  }

  @ReactMethod
  fun remove(service: String, promise: Promise) {
    try {
      val keyId = keyId(service)
      val removed = preferences.edit()
        .remove("$keyId.iv")
        .remove("$keyId.value")
        .commit()
      if (!removed) {
        promise.reject(
          "SECURE_CREDENTIAL_REMOVE_FAILED",
          "Unable to remove the Mira device credential",
        )
        return
      }
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject(
        "SECURE_CREDENTIAL_REMOVE_FAILED",
        "Unable to remove the Mira device credential",
        error,
      )
    }
  }

  private fun getOrCreateKey(): SecretKey {
    val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
    val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
    if (existing != null) {
      return existing
    }

    val generator = KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES,
      KEYSTORE_PROVIDER,
    )
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setUserAuthenticationRequired(false)
        .build(),
    )
    return generator.generateKey()
  }

  private fun keyId(service: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
      .digest(service.toByteArray(StandardCharsets.UTF_8))
    return digest.joinToString("") { byte -> "%02x".format(byte) }
  }

  companion object {
    private const val MODULE_NAME = "MiraSecureCredentialStore"
    private const val PREFERENCES_NAME = "mira_secure_credentials_v1"
    private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
    private const val KEY_ALIAS = "io.tomz.mira.mobile.remote-device.v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_LENGTH_BITS = 128
  }
}
