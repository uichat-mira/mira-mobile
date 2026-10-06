#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

static NSString * const MiraPushProviderTokenDidChange = @"MiraPushProviderTokenDidChange";
static NSString * const MiraPushProviderTokenDidFail = @"MiraPushProviderTokenDidFail";
static NSString * const MiraPushProviderTokenChangedEvent = @"pushProviderTokenChanged";

@interface MiraNotifications : RCTEventEmitter <RCTBridgeModule, UNUserNotificationCenterDelegate>
@property(nonatomic, copy, nullable) RCTPromiseResolveBlock pushTokenResolve;
@property(nonatomic, copy, nullable) RCTPromiseRejectBlock pushTokenReject;
@property(nonatomic, assign) BOOL observingPushEvents;
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
  dispatch_async(dispatch_get_main_queue(), ^{
    [[UIApplication sharedApplication] registerForRemoteNotifications];
  });
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

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler
{
  completionHandler(
    UNNotificationPresentationOptionBanner |
    UNNotificationPresentationOptionList |
    UNNotificationPresentationOptionSound
  );
}

@end
