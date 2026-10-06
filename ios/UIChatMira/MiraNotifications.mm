#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

static NSString * const MiraPushProviderTokenDidChange = @"MiraPushProviderTokenDidChange";
static NSString * const MiraPushProviderTokenDidFail = @"MiraPushProviderTokenDidFail";
static NSString * const MiraPushProviderTokenChangedEvent = @"pushProviderTokenChanged";
static NSString * const MiraRemotePushDedupeKey = @"mira.remote.push.presentation.canonical-ids.v1";
static NSUInteger const MiraRemotePushDedupeLimit = 128;

@interface MiraNoRedirectSessionDelegate : NSObject <NSURLSessionTaskDelegate>
@end

@implementation MiraNoRedirectSessionDelegate

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
willPerformHTTPRedirection:(NSHTTPURLResponse *)response
        newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest * _Nullable))completionHandler
{
  completionHandler(nil);
}

@end

@interface MiraNotifications : RCTEventEmitter <RCTBridgeModule, UNUserNotificationCenterDelegate>
@property(nonatomic, copy, nullable) RCTPromiseResolveBlock pushTokenResolve;
@property(nonatomic, copy, nullable) RCTPromiseRejectBlock pushTokenReject;
@property(nonatomic, assign) BOOL observingPushEvents;
@property(nonatomic, assign) NSUInteger pushTokenRequestId;
@end

@implementation MiraNotifications

RCT_EXPORT_MODULE(MiraNotifications)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (instancetype)init
{
  self = [super init];
  if (self) {
    [UNUserNotificationCenter currentNotificationCenter].delegate = self;
    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    [center addObserver:self
               selector:@selector(handlePushProviderToken:)
                   name:MiraPushProviderTokenDidChange
                 object:nil];
    [center addObserver:self
               selector:@selector(handlePushProviderFailure:)
                   name:MiraPushProviderTokenDidFail
                 object:nil];
  }
  return self;
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[MiraPushProviderTokenChangedEvent];
}

- (void)startObserving
{
  self.observingPushEvents = YES;
}

- (void)stopObserving
{
  self.observingPushEvents = NO;
}

- (NSString *)statusString:(UNAuthorizationStatus)status
{
  if (status == UNAuthorizationStatusAuthorized ||
      status == UNAuthorizationStatusProvisional ||
      status == UNAuthorizationStatusEphemeral) {
    return @"granted";
  }
  if (status == UNAuthorizationStatusNotDetermined) {
    return @"not-determined";
  }
  if (status == UNAuthorizationStatusDenied) {
    return @"denied";
  }
  return @"unavailable";
}

RCT_REMAP_METHOD(getPermissionStatus,
                 getPermissionStatusWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  [[UNUserNotificationCenter currentNotificationCenter]
    getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
      resolve([self statusString:settings.authorizationStatus]);
    }];
}

RCT_REMAP_METHOD(getPushProviderToken,
                 getPushProviderTokenWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (self.pushTokenResolve != nil) {
    reject(@"PUSH_PROVIDER_REGISTRATION_IN_PROGRESS",
           @"APNs registration is already in progress",
           nil);
    return;
  }

  self.pushTokenResolve = resolve;
  self.pushTokenReject = reject;
  self.pushTokenRequestId += 1;
  NSUInteger requestId = self.pushTokenRequestId;
  dispatch_async(dispatch_get_main_queue(), ^{
    [[UIApplication sharedApplication] registerForRemoteNotifications];
  });
  dispatch_after(
    dispatch_time(DISPATCH_TIME_NOW, (int64_t)(30 * NSEC_PER_SEC)),
    dispatch_get_main_queue(),
    ^{
      if (
        self.pushTokenRequestId == requestId &&
        self.pushTokenResolve != nil &&
        self.pushTokenReject != nil
      ) {
        self.pushTokenReject(
          @"PUSH_PROVIDER_REGISTRATION_TIMEOUT",
          @"APNs registration timed out",
          nil
        );
        self.pushTokenResolve = nil;
        self.pushTokenReject = nil;
      }
    }
  );
}

RCT_REMAP_METHOD(postPushBrokerJson,
                 postPushBrokerJson:(NSString *)urlString
                 body:(NSString *)body
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURLComponents *components = [NSURLComponents componentsWithString:urlString];
  NSURL *url = components.URL;
  NSString *scheme = components.scheme.lowercaseString;
  NSString *host = components.host.lowercaseString;
  BOOL local =
    [host isEqualToString:@"localhost"] ||
    [host isEqualToString:@"127.0.0.1"] ||
    [host isEqualToString:@"::1"];
  BOOL allowInsecureLocal = NO;
#if DEBUG
  allowInsecureLocal = local && [scheme isEqualToString:@"http"];
#endif

  if (url == nil || (![scheme isEqualToString:@"https"] && !allowInsecureLocal)) {
    reject(
      @"PUSH_BROKER_URL_REJECTED",
      @"Push Broker requires HTTPS outside local development",
      nil
    );
    return;
  }

  NSURLSessionConfiguration *configuration =
    [NSURLSessionConfiguration ephemeralSessionConfiguration];
  configuration.timeoutIntervalForRequest = 10;
  configuration.timeoutIntervalForResource = 10;
  MiraNoRedirectSessionDelegate *delegate =
    [[MiraNoRedirectSessionDelegate alloc] init];
  NSURLSession *session =
    [NSURLSession sessionWithConfiguration:configuration
                                  delegate:delegate
                             delegateQueue:nil];

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  request.HTTPMethod = @"POST";
  [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
  [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
  request.HTTPBody = [body dataUsingEncoding:NSUTF8StringEncoding];

  NSURLSessionDataTask *task =
    [session dataTaskWithRequest:request
              completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
      if (error != nil) {
        reject(
          @"PUSH_BROKER_NETWORK_ERROR",
          @"Unable to reach Push Broker",
          error
        );
        [session invalidateAndCancel];
        return;
      }
      if (![response isKindOfClass:[NSHTTPURLResponse class]]) {
        reject(
          @"PUSH_BROKER_INVALID_RESPONSE",
          @"Push Broker returned an invalid response",
          nil
        );
        [session invalidateAndCancel];
        return;
      }

      NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;
      NSString *responseBody =
        data != nil
          ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]
          : @"";
      resolve(@{
        @"status": @(httpResponse.statusCode),
        @"body": responseBody ?: @"",
      });
      [session finishTasksAndInvalidate];
    }];
  [task resume];
}

RCT_REMAP_METHOD(requestPermission,
                 requestPermissionWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  UNAuthorizationOptions options =
    UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
  [[UNUserNotificationCenter currentNotificationCenter]
    requestAuthorizationWithOptions:options
    completionHandler:^(BOOL granted, NSError *error) {
      if (error != nil) {
        reject(@"NOTIFICATION_PERMISSION_REQUEST_FAILED",
               @"Unable to request notification permission",
               error);
        return;
      }
      resolve(granted ? @"granted" : @"denied");
    }];
}

RCT_REMAP_METHOD(showTestNotification,
                 showTestNotificationWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    NSString *status = [self statusString:settings.authorizationStatus];
    if (![status isEqualToString:@"granted"]) {
      reject(@"NOTIFICATION_PERMISSION_REQUIRED",
             @"Notification permission must be enabled before sending a test notification",
             nil);
      return;
    }

    UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
    content.title = @"Mira 通知测试";
    content.body = @"通知功能已正常启用。";
    content.sound = [UNNotificationSound defaultSound];

    UNTimeIntervalNotificationTrigger *trigger =
      [UNTimeIntervalNotificationTrigger triggerWithTimeInterval:1 repeats:NO];
    UNNotificationRequest *request =
      [UNNotificationRequest requestWithIdentifier:@"mira.test.notification"
                                           content:content
                                           trigger:trigger];

    [center addNotificationRequest:request withCompletionHandler:^(NSError *error) {
      if (error != nil) {
        reject(@"TEST_NOTIFICATION_FAILED", @"Unable to schedule the Mira test notification", error);
        return;
      }
      resolve(nil);
    }];
  }];
}

- (void)handlePushProviderToken:(NSNotification *)notification
{
  NSString *token = notification.userInfo[@"token"];
  if (![token isKindOfClass:[NSString class]] || token.length == 0) {
    return;
  }

  NSDictionary *payload = @{
    @"platform": @"ios",
    @"token": token,
  };
  if (self.pushTokenResolve != nil) {
    self.pushTokenResolve(payload);
    self.pushTokenResolve = nil;
    self.pushTokenReject = nil;
  }
  if (self.observingPushEvents) {
    [self sendEventWithName:MiraPushProviderTokenChangedEvent body:payload];
  }
}

- (void)handlePushProviderFailure:(NSNotification *)notification
{
  NSString *message = notification.userInfo[@"message"];
  if (self.pushTokenReject != nil) {
    self.pushTokenReject(
      @"PUSH_PROVIDER_REGISTRATION_FAILED",
      [message isKindOfClass:[NSString class]] ? message : @"Unable to register with APNs",
      nil
    );
    self.pushTokenResolve = nil;
    self.pushTokenReject = nil;
  }
}

- (NSString * _Nullable)validatedRemoteCanonicalMessageId:(NSDictionary *)userInfo
{
  id miraValue = userInfo[@"mira"];
  if (![miraValue isKindOfClass:[NSDictionary class]]) {
    return nil;
  }
  NSDictionary *mira = (NSDictionary *)miraValue;
  id schemaVersion = mira[@"schemaVersion"];
  BOOL validSchema =
    ([schemaVersion isKindOfClass:[NSNumber class]] && [schemaVersion integerValue] == 1) ||
    ([schemaVersion isKindOfClass:[NSString class]] && [(NSString *)schemaVersion isEqualToString:@"1"]);
  if (!validSchema ||
      ![mira[@"eventType"] isEqual:@"assistant-message"] ||
      ![mira[@"eligibilityEvent"] isEqual:@"final_transition_first_seen"]) {
    return nil;
  }

  NSArray<NSString *> *identityKeys = @[
    @"installationId",
    @"eventId",
    @"sourceId",
    @"canonicalMessageId",
  ];
  for (NSString *key in identityKeys) {
    id value = mira[key];
    if (![value isKindOfClass:[NSString class]]) {
      return nil;
    }
    NSString *stringValue = [(NSString *)value stringByTrimmingCharactersInSet:
      [NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (stringValue.length == 0 || stringValue.length > 512 ||
        [stringValue rangeOfCharacterFromSet:[NSCharacterSet newlineCharacterSet]].location != NSNotFound) {
      return nil;
    }
  }
  return mira[@"canonicalMessageId"];
}

- (BOOL)recordRemoteCanonicalMessageIfNew:(NSString *)canonicalMessageId
{
  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  NSArray<NSString *> *stored = [defaults stringArrayForKey:MiraRemotePushDedupeKey] ?: @[];
  if ([stored containsObject:canonicalMessageId]) {
    return NO;
  }

  NSMutableArray<NSString *> *next = [stored mutableCopy];
  [next addObject:canonicalMessageId];
  if (next.count > MiraRemotePushDedupeLimit) {
    NSRange overflow = NSMakeRange(0, next.count - MiraRemotePushDedupeLimit);
    [next removeObjectsInRange:overflow];
  }
  [defaults setObject:next forKey:MiraRemotePushDedupeKey];
  return YES;
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler
{
  NSString *canonicalMessageId =
    [self validatedRemoteCanonicalMessageId:notification.request.content.userInfo];
  if (canonicalMessageId != nil) {
    [self recordRemoteCanonicalMessageIfNew:canonicalMessageId];

    // APNs alert pushes may be shown directly by iOS in background/killed
    // states. When Mira is foreground this delegate is executing, so suppress
    // the system banner/sound and leave the foreground reminder to MOB-056B.
    completionHandler(UNNotificationPresentationOptionNone);
    return;
  }

  if ([notification.request.identifier isEqualToString:@"mira.test.notification"]) {
    // Keep the explicit local test-notification behavior unchanged.
    completionHandler(
      UNNotificationPresentationOptionBanner |
      UNNotificationPresentationOptionList |
      UNNotificationPresentationOptionSound
    );
    return;
  }

  // Unknown or malformed notification payloads must not become Mira foreground
  // message notifications merely because they reached UserNotifications.
  completionHandler(UNNotificationPresentationOptionNone);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
 didReceiveNotificationResponse:(UNNotificationResponse *)response
         withCompletionHandler:(void (^)(void))completionHandler
{
  NSString *canonicalMessageId =
    [self validatedRemoteCanonicalMessageId:response.notification.request.content.userInfo];
  if (canonicalMessageId != nil) {
    [self recordRemoteCanonicalMessageIfNew:canonicalMessageId];
  }

  // Tapping a normal alert already brings the application to the foreground.
  // v1 intentionally does not invent a conversation deep-link contract.
  completionHandler();
}

@end
