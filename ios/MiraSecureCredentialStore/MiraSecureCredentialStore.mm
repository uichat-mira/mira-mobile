#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <React/RCTBridgeModule.h>

@interface MiraSecureCredentialStore : NSObject <RCTBridgeModule>
@end

@implementation MiraSecureCredentialStore

RCT_EXPORT_MODULE(MiraSecureCredentialStore)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSMutableDictionary *)queryForService:(NSString *)service
{
  return [@{
    (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService : service,
    (__bridge id)kSecAttrAccount : @"credential",
  } mutableCopy];
}

RCT_REMAP_METHOD(get,
                 getForService:(NSString *)service
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (service.length == 0) {
    reject(@"SECURE_CREDENTIAL_INVALID_SERVICE", @"Credential service name cannot be empty", nil);
    return;
  }

  NSMutableDictionary *query = [self queryForService:service];
  query[(__bridge id)kSecReturnData] = @YES;
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;

  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
  if (status == errSecItemNotFound) {
    resolve(nil);
    return;
  }
  if (status != errSecSuccess) {
    reject(@"SECURE_CREDENTIAL_READ_FAILED", @"Unable to read the Mira device credential", nil);
    return;
  }

  NSData *data = (__bridge_transfer NSData *)result;
  NSString *value = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  if (value == nil) {
    reject(@"SECURE_CREDENTIAL_READ_FAILED", @"Unable to decode the Mira device credential", nil);
    return;
  }
  resolve(value);
}

RCT_REMAP_METHOD(set,
                 setForService:(NSString *)service
                 value:(NSString *)value
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (service.length == 0) {
    reject(@"SECURE_CREDENTIAL_INVALID_SERVICE", @"Credential service name cannot be empty", nil);
    return;
  }

  NSMutableDictionary *query = [self queryForService:service];
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *attributes = @{
    (__bridge id)kSecValueData : data,
    (__bridge id)kSecAttrAccessible : (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
  };

  OSStatus status = SecItemUpdate(
    (__bridge CFDictionaryRef)query,
    (__bridge CFDictionaryRef)attributes
  );
  if (status == errSecItemNotFound) {
    [query addEntriesFromDictionary:attributes];
    status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
  }

  if (status != errSecSuccess) {
    reject(@"SECURE_CREDENTIAL_WRITE_FAILED", @"Unable to persist the Mira device credential", nil);
    return;
  }
  resolve(nil);
}

RCT_REMAP_METHOD(randomBytes,
                 randomBytesWithLength:(nonnull NSNumber *)length
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSInteger byteLength = [length integerValue];
  if (byteLength < 1 || byteLength > 1024) {
    reject(@"SECURE_RANDOM_INVALID_LENGTH",
           @"Secure random byte length must be between 1 and 1024",
           nil);
    return;
  }

  NSMutableData *data = [NSMutableData dataWithLength:(NSUInteger)byteLength];
  int status = SecRandomCopyBytes(
    kSecRandomDefault,
    (size_t)byteLength,
    (uint8_t *)data.mutableBytes
  );
  if (status != errSecSuccess) {
    reject(@"SECURE_RANDOM_FAILED", @"Unable to generate secure random bytes", nil);
    return;
  }

  NSString *encoded = [data base64EncodedStringWithOptions:0];
  encoded = [[encoded stringByReplacingOccurrencesOfString:@"+" withString:@"-"]
    stringByReplacingOccurrencesOfString:@"/" withString:@"_"];
  while ([encoded hasSuffix:@"="]) {
    encoded = [encoded substringToIndex:encoded.length - 1];
  }
  resolve(encoded);
}

RCT_REMAP_METHOD(remove,
                 removeForService:(NSString *)service
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (service.length == 0) {
    reject(@"SECURE_CREDENTIAL_INVALID_SERVICE", @"Credential service name cannot be empty", nil);
    return;
  }

  NSDictionary *query = [self queryForService:service];
  OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
  if (status != errSecSuccess && status != errSecItemNotFound) {
    reject(@"SECURE_CREDENTIAL_REMOVE_FAILED", @"Unable to remove the Mira device credential", nil);
    return;
  }
  resolve(nil);
}

@end
