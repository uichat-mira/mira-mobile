#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

#include <arpa/inet.h>
#include <dispatch/dispatch.h>
#include <netdb.h>
#include <string.h>
#include <sys/socket.h>

static BOOL MiraIPv4IsPublic(const uint8_t *bytes) {
  const uint8_t a = bytes[0];
  const uint8_t b = bytes[1];
  const uint8_t c = bytes[2];
  if (a == 0 || a == 10 || a == 127) return NO;
  if (a == 100 && b >= 64 && b <= 127) return NO;
  if (a == 169 && b == 254) return NO;
  if (a == 172 && b >= 16 && b <= 31) return NO;
  if (a == 192 && b == 0 && (c == 0 || c == 2)) return NO;
  if (a == 192 && b == 88 && c == 99) return NO;
  if (a == 192 && b == 168) return NO;
  if (a == 198 && (b == 18 || b == 19)) return NO;
  if (a == 198 && b == 51 && c == 100) return NO;
  if (a == 203 && b == 0 && c == 113) return NO;
  return a < 224;
}

static BOOL MiraIPv6IsPublic(const uint8_t *bytes) {
  if ((bytes[0] & 0xe0) != 0x20) return NO;
  if (bytes[0] == 0x20 && bytes[1] == 0x01) {
    const unsigned int third = ((unsigned int)bytes[2] << 8) | bytes[3];
    if (third <= 0x01ff) return NO;
    if (third == 0x0db8) return NO;
    if (third == 0x0002) return NO;
    if (third == 0x0020) return NO;
  }
  if (bytes[0] == 0x20 && bytes[1] == 0x02) return NO;
  if (bytes[0] == 0x3f && bytes[1] == 0xff && (bytes[2] & 0xf0) == 0) return NO;
  return YES;
}

static BOOL MiraSockaddrIsPublic(const struct sockaddr *address) {
  if (address == NULL) return NO;
  if (address->sa_family == AF_INET) {
    const struct sockaddr_in *v4 = (const struct sockaddr_in *)address;
    return MiraIPv4IsPublic((const uint8_t *)&v4->sin_addr);
  }
  if (address->sa_family == AF_INET6) {
    const struct sockaddr_in6 *v6 = (const struct sockaddr_in6 *)address;
    return MiraIPv6IsPublic((const uint8_t *)&v6->sin6_addr);
  }
  return NO;
}

static BOOL MiraHostIsLocal(NSString *host) {
  NSString *lower = [[host lowercaseString] stringByRemovingPercentEncoding];
  if (lower == nil) return YES;
  if ([lower hasSuffix:@"."]) lower = [lower substringToIndex:lower.length - 1];
  if ([lower isEqualToString:@"localhost"]) return YES;
  NSArray<NSString *> *suffixes = @[
    @".localhost", @".local", @".localdomain", @".internal",
    @".intranet", @".lan", @".home", @".corp",
  ];
  for (NSString *suffix in suffixes) {
    if ([lower hasSuffix:suffix]) return YES;
  }
  return NO;
}

static BOOL MiraHostIsUnqualified(NSString *host) {
  NSString *lower = [[host lowercaseString] stringByRemovingPercentEncoding];
  if ([lower hasSuffix:@"."]) lower = [lower substringToIndex:lower.length - 1];
  return ![lower containsString:@"."] && ![lower containsString:@":"];
}

static BOOL MiraLiteralIsPublic(NSString *host, BOOL *isLiteral) {
  const char *utf8 = host.UTF8String;
  if (utf8 == NULL) return NO;
  struct in_addr v4;
  if (inet_pton(AF_INET, utf8, &v4) == 1) {
    *isLiteral = YES;
    return MiraIPv4IsPublic((const uint8_t *)&v4);
  }
  struct in6_addr v6;
  if (inet_pton(AF_INET6, utf8, &v6) == 1) {
    *isLiteral = YES;
    return MiraIPv6IsPublic((const uint8_t *)&v6);
  }
  *isLiteral = NO;
  return NO;
}

static NSString *MiraCharsetOfContentType(NSString *contentType) {
  NSRegularExpression *regex = [NSRegularExpression
    regularExpressionWithPattern:@"charset\\s*=\\s*\"?([^;\"\\s]+)"
                         options:NSRegularExpressionCaseInsensitive
                           error:nil];
  NSTextCheckingResult *match = [regex firstMatchInString:contentType
                                                  options:0
                                                    range:NSMakeRange(0, contentType.length)];
  if (match != nil && match.numberOfRanges > 1) {
    return [contentType substringWithRange:[match rangeAtIndex:1]];
  }
  return nil;
}

static NSString *MiraDecodeBody(NSData *data, NSString *contentType) {
  NSString *charset = MiraCharsetOfContentType(contentType);
  if (charset != nil) {
    CFStringEncoding cfEncoding = CFStringConvertIANACharSetNameToEncoding((__bridge CFStringRef)charset);
    if (cfEncoding != kCFStringEncodingInvalidId) {
      NSStringEncoding encoding = CFStringConvertEncodingToNSStringEncoding(cfEncoding);
      NSString *decoded = [[NSString alloc] initWithData:data encoding:encoding];
      if (decoded != nil) return decoded;
    }
  }
  NSString *utf8 = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  if (utf8 != nil) return utf8;
  return [[NSString alloc] initWithData:data encoding:NSISOLatin1StringEncoding] ?: @"";
}

@interface MiraWebFetcherRequest : NSObject
@property(nonatomic, copy) NSString *requestId;
@property(nonatomic, strong) NSURLSessionDataTask *task;
@property(nonatomic, strong) NSMutableData *data;
@property(nonatomic, strong) NSURL *currentURL;
@property(nonatomic, strong) NSDate *deadline;
@property(nonatomic, assign) NSUInteger maxBytes;
@property(nonatomic, assign) NSInteger status;
@property(nonatomic, assign) NSInteger redirects;
@property(nonatomic, copy) NSString *contentType;
@property(nonatomic, assign) BOOL finished;
@property(nonatomic, strong) dispatch_source_t timeoutSource;
@property(nonatomic, copy) RCTPromiseResolveBlock resolve;
@property(nonatomic, copy) RCTPromiseRejectBlock reject;
@end

@implementation MiraWebFetcherRequest
@end

@interface MiraWebFetcher : NSObject <RCTBridgeModule, NSURLSessionDataDelegate>
@property(nonatomic, strong) NSURLSession *session;
@property(nonatomic, strong) NSOperationQueue *stateQueue;
@property(nonatomic, strong) dispatch_queue_t timerQueue;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, MiraWebFetcherRequest *> *requests;
@property(nonatomic, strong) MiraWebFetcherRequest *active;
@end

@implementation MiraWebFetcher

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (instancetype)init {
  if (self = [super init]) {
    _stateQueue = [NSOperationQueue new];
    _stateQueue.maxConcurrentOperationCount = 1;
    _stateQueue.qualityOfService = NSQualityOfServiceUtility;
    _timerQueue = dispatch_queue_create("io.tomz.mira.web-fetcher-timer", DISPATCH_QUEUE_SERIAL);
    _requests = [NSMutableDictionary dictionary];
    NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    configuration.HTTPCookieStorage = nil;
    configuration.URLCredentialStorage = nil;
    configuration.URLCache = nil;
    configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
    configuration.HTTPMaximumConnectionsPerHost = 1;
    configuration.timeoutIntervalForRequest = 30;
    configuration.timeoutIntervalForResource = 30;
    _session = [NSURLSession sessionWithConfiguration:configuration
                                             delegate:self
                                        delegateQueue:_stateQueue];
  }
  return self;
}

RCT_EXPORT_METHOD(fetch:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSString *requestId = [options[@"requestId"] isKindOfClass:[NSString class]] ? options[@"requestId"] : nil;
  NSString *urlString = [options[@"url"] isKindOfClass:[NSString class]] ? options[@"url"] : nil;
  NSNumber *maxBytes = [options[@"maxBytes"] isKindOfClass:[NSNumber class]] ? options[@"maxBytes"] : nil;
  NSNumber *timeoutMs = [options[@"timeoutMs"] isKindOfClass:[NSNumber class]] ? options[@"timeoutMs"] : nil;
  if (requestId.length == 0 || urlString.length == 0 || maxBytes == nil || timeoutMs == nil ||
      maxBytes.unsignedIntegerValue == 0 || maxBytes.unsignedIntegerValue > 4 * 1024 * 1024 ||
      timeoutMs.integerValue <= 0 || timeoutMs.integerValue > 60000) {
    reject(@"WEB_ARGUMENTS_INVALID", @"Invalid web fetch options.", nil);
    return;
  }

  [self.stateQueue addOperationWithBlock:^{
    if (self.active != nil) {
      reject(@"WEB_BUSY", @"Another web page request is still running.", nil);
      return;
    }
    MiraWebFetcherRequest *request = [MiraWebFetcherRequest new];
    request.requestId = requestId;
    request.maxBytes = maxBytes.unsignedIntegerValue;
    request.resolve = resolve;
    request.reject = reject;
    request.data = [NSMutableData data];
    request.deadline = [NSDate dateWithTimeIntervalSinceNow:timeoutMs.doubleValue / 1000.0];
    self.active = request;

    NSString *code = nil;
    NSString *message = nil;
    NSURL *url = [self allowedURLFromString:urlString code:&code message:&message deadline:request.deadline];
    if (url == nil) {
      [self finish:request code:code message:message result:nil];
      return;
    }
    request.currentURL = url;

    NSMutableURLRequest *urlRequest = [NSMutableURLRequest requestWithURL:url
                                                              cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
                                                          timeoutInterval:MAX(1.0, [request.deadline timeIntervalSinceNow])];
    [urlRequest setHTTPMethod:@"GET"];
    [urlRequest setValue:@"text/html,application/xhtml+xml,text/plain,application/json,text/markdown,application/xml,text/xml,text/csv;q=0.9,*/*;q=0.1"
      forHTTPHeaderField:@"Accept"];
    [urlRequest setValue:@"zh-CN,zh;q=0.9,en;q=0.7" forHTTPHeaderField:@"Accept-Language"];
    [urlRequest setValue:@"MiraMobile/0.4 web-tool" forHTTPHeaderField:@"User-Agent"];
    [urlRequest setValue:@"no-cache" forHTTPHeaderField:@"Cache-Control"];

    NSURLSessionDataTask *task = [self.session dataTaskWithRequest:urlRequest];
    request.task = task;
    self.requests[@(task.taskIdentifier)] = request;

    NSTimeInterval delay = MAX(0, [request.deadline timeIntervalSinceNow]);
    __weak MiraWebFetcher *weakSelf = self;
    dispatch_source_t timeout = dispatch_source_create(
      DISPATCH_SOURCE_TYPE_TIMER, 0, 0, self.timerQueue);
    dispatch_source_set_timer(
      timeout,
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)),
      DISPATCH_TIME_FOREVER,
      100 * NSEC_PER_MSEC);
    request.timeoutSource = timeout;
    dispatch_source_set_event_handler(timeout, ^{
      MiraWebFetcher *strongSelf = weakSelf;
      if (strongSelf == nil) return;
      [strongSelf.stateQueue addOperationWithBlock:^{
        if (request.finished) return;
        [strongSelf finish:request
                      code:@"WEB_TIMEOUT"
                   message:@"The web page did not finish within the timeout."
                    result:nil];
      }];
    });
    dispatch_resume(timeout);
    [task resume];
  }];
}

RCT_EXPORT_METHOD(cancel:(NSString *)requestId) {
  [self.stateQueue addOperationWithBlock:^{
    MiraWebFetcherRequest *request = self.active;
    if (request == nil || ![request.requestId isEqualToString:requestId] || request.finished) return;
    [self finish:request code:@"WEB_CANCELLED" message:@"Web page read was cancelled." result:nil];
  }];
}

- (void)invalidate {
  [self.stateQueue addOperationWithBlock:^{
    MiraWebFetcherRequest *request = self.active;
    if (request != nil && !request.finished) {
      [self finish:request code:@"WEB_CANCELLED" message:@"Web page read was cancelled." result:nil];
    }
    [self.session invalidateAndCancel];
    self.session = nil;
  }];
}

- (void)finish:(MiraWebFetcherRequest *)request
          code:(NSString *)code
       message:(NSString *)message
        result:(NSDictionary *)result {
  if (request.finished) return;
  request.finished = YES;
  if (request.timeoutSource != nil) {
    dispatch_source_cancel(request.timeoutSource);
    request.timeoutSource = nil;
  }
  if (request.task != nil) {
    [self.requests removeObjectForKey:@(request.task.taskIdentifier)];
    [request.task cancel];
  }
  if (self.active == request) self.active = nil;
  RCTPromiseResolveBlock resolve = request.resolve;
  RCTPromiseRejectBlock reject = request.reject;
  request.resolve = nil;
  request.reject = nil;
  request.data = nil;
  if (result != nil) {
    if (resolve != nil) resolve(result);
  } else if (reject != nil) {
    reject(code ?: @"WEB_UPSTREAM_FAILED", message ?: @"Unable to read the web page.", nil);
  }
}

#pragma mark - URL and address policy

- (NSURL *)allowedURLFromString:(NSString *)value
                           code:(NSString **)code
                        message:(NSString **)message
                       deadline:(NSDate *)deadline {
  NSURLComponents *components = [NSURLComponents componentsWithString:value];
  NSString *scheme = [components.scheme lowercaseString];
  if (components == nil || (![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"])) {
    *code = @"WEB_URL_FORBIDDEN";
    *message = @"Only public HTTP(S) URLs are supported.";
    return nil;
  }
  if (components.user != nil || components.password != nil) {
    *code = @"WEB_URL_FORBIDDEN";
    *message = @"URL credentials are not allowed.";
    return nil;
  }
  NSString *host = components.host;
  if ([host hasPrefix:@"["] && [host hasSuffix:@"]"]) {
    host = [host substringWithRange:NSMakeRange(1, host.length - 2)];
  }
  if (host.length == 0 || host.length > 253) {
    *code = @"WEB_URL_FORBIDDEN";
    *message = @"The URL hostname is invalid.";
    return nil;
  }

  BOOL literal = NO;
  if (MiraLiteralIsPublic(host, &literal)) {
    // public literal
  } else if (literal) {
    *code = @"WEB_URL_FORBIDDEN";
    *message = @"The address is not on the public internet.";
    return nil;
  } else {
    if (MiraHostIsLocal(host)) {
      *code = @"WEB_URL_FORBIDDEN";
      *message = @"Local hostnames are not allowed.";
      return nil;
    }
    if (MiraHostIsUnqualified(host)) {
      *code = @"WEB_URL_FORBIDDEN";
      *message = @"Only fully-qualified public hostnames are allowed.";
      return nil;
    }
    NSString *resolutionCode = nil;
    NSString *resolutionMessage = nil;
    if (![self hostResolvesToPublicAddresses:host
                                    deadline:deadline
                                        code:&resolutionCode
                                     message:&resolutionMessage]) {
      *code = resolutionCode;
      *message = resolutionMessage;
      return nil;
    }
  }

  NSURL *url = components.URL;
  if (url == nil) {
    *code = @"WEB_URL_FORBIDDEN";
    *message = @"The URL is not valid.";
  }
  return url;
}

- (BOOL)hostResolvesToPublicAddresses:(NSString *)host
                             deadline:(NSDate *)deadline
                                 code:(NSString **)code
                              message:(NSString **)message {
  // NSURLSession re-resolves the hostname internally after this check. Every
  // address returned here must be public, but a DNS answer that changes between
  // validation and connect is still a residual TOCTOU/rebinding risk on iOS.
  // Android pins this check's answers through OkHttp's Dns contract.
  __block BOOL resolved = NO;
  __block BOOL hasPrivate = NO;
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    struct addrinfo hints;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    struct addrinfo *result = NULL;
    int status = getaddrinfo(host.UTF8String, NULL, &hints, &result);
    if (status != 0 || result == NULL) {
      dispatch_semaphore_signal(semaphore);
      return;
    }
    resolved = YES;
    for (struct addrinfo *entry = result; entry != NULL; entry = entry->ai_next) {
      if (!MiraSockaddrIsPublic(entry->ai_addr)) hasPrivate = YES;
    }
    freeaddrinfo(result);
    dispatch_semaphore_signal(semaphore);
  });

  NSTimeInterval remaining = [deadline timeIntervalSinceNow];
  if (remaining <= 0 ||
      dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(MAX(0, remaining) * NSEC_PER_SEC))) != 0) {
    *code = @"WEB_TIMEOUT";
    *message = @"The hostname did not resolve within the timeout.";
    return NO;
  }
  if (!resolved) {
    *code = @"WEB_DNS_FAILED";
    *message = @"The hostname did not resolve.";
    return NO;
  }
  if (hasPrivate) {
    *code = @"WEB_URL_FORBIDDEN";
    *message = @"The hostname resolves to a non-public address.";
    return NO;
  }
  return YES;
}

#pragma mark - NSURLSessionDataDelegate

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
willPerformHTTPRedirection:(NSHTTPURLResponse *)response
        newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest * _Nullable))completionHandler {
  MiraWebFetcherRequest *state = self.requests[@(task.taskIdentifier)];
  if (state == nil || state.finished) {
    completionHandler(nil);
    return;
  }
  if (state.redirects >= 5) {
    [self finish:state code:@"WEB_REDIRECT_LIMIT" message:@"The page redirected too many times." result:nil];
    completionHandler(nil);
    return;
  }
  NSString *code = nil;
  NSString *message = nil;
  NSURL *url = [self allowedURLFromString:request.URL.absoluteString
                                    code:&code
                                 message:&message
                                deadline:state.deadline];
  if (url == nil) {
    [self finish:state
            code:@"WEB_REDIRECT_FORBIDDEN"
         message:message ?: @"The page redirected to a non-public address."
          result:nil];
    completionHandler(nil);
    return;
  }
  state.redirects += 1;
  state.currentURL = url;
  completionHandler(request);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
didReceiveResponse:(NSURLResponse *)response
 completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
  MiraWebFetcherRequest *state = self.requests[@(dataTask.taskIdentifier)];
  if (state == nil || state.finished) {
    completionHandler(NSURLSessionResponseCancel);
    return;
  }
  if (![response isKindOfClass:[NSHTTPURLResponse class]]) {
    [self finish:state code:@"WEB_UPSTREAM_FAILED" message:@"The page returned an invalid response." result:nil];
    completionHandler(NSURLSessionResponseCancel);
    return;
  }
  NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
  state.status = http.statusCode;
  NSString *header = [http valueForHTTPHeaderField:@"Content-Type"];
  if (![header isKindOfClass:[NSString class]] || header.length == 0) {
    header = @"text/plain";
  }
  state.contentType = header;
  NSString *mime = [[header componentsSeparatedByString:@";"] firstObject];
  mime = [[mime stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] lowercaseString];

  NSSet<NSString *> *supported = [NSSet setWithArray:@[
    @"text/html", @"application/xhtml+xml", @"text/plain", @"text/markdown",
    @"application/json", @"application/xml", @"text/xml", @"application/ld+json",
    @"text/csv", @"application/rss+xml", @"application/atom+xml",
  ]];
  if (![supported containsObject:mime]) {
    [self finish:state
            code:@"WEB_UNSUPPORTED_CONTENT_TYPE"
         message:[NSString stringWithFormat:@"The page content type is not readable text: %@", mime]
          result:nil];
    completionHandler(NSURLSessionResponseCancel);
    return;
  }
  long long declared = response.expectedContentLength;
  if (declared > 0 && (unsigned long long)declared > state.maxBytes) {
    [self finish:state code:@"WEB_RESPONSE_TOO_LARGE" message:@"The page exceeds the download limit." result:nil];
    completionHandler(NSURLSessionResponseCancel);
    return;
  }
  state.data = [NSMutableData data];
  completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveData:(NSData *)data {
  MiraWebFetcherRequest *state = self.requests[@(dataTask.taskIdentifier)];
  if (state == nil || state.finished) return;
  if (state.data.length + data.length > state.maxBytes) {
    [self finish:state code:@"WEB_RESPONSE_TOO_LARGE" message:@"The page exceeds the download limit." result:nil];
    return;
  }
  [state.data appendData:data];
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
didCompleteWithError:(NSError *)error {
  MiraWebFetcherRequest *state = self.requests[@(task.taskIdentifier)];
  if (state == nil || state.finished) return;
  if (error != nil) {
    if (error.code == NSURLErrorTimedOut) {
      [self finish:state code:@"WEB_TIMEOUT" message:@"The web page did not finish within the timeout." result:nil];
    } else if (error.code == NSURLErrorCancelled) {
      [self finish:state code:@"WEB_CANCELLED" message:@"Web page read was cancelled." result:nil];
    } else {
      [self finish:state code:@"WEB_UPSTREAM_FAILED" message:@"Unable to read the web page." result:nil];
    }
    return;
  }
  if (state.status >= 400) {
    [self finish:state
            code:@"WEB_HTTP_ERROR"
         message:[NSString stringWithFormat:@"The page returned HTTP %ld.", (long)state.status]
          result:nil];
    return;
  }
  if (state.status <= 0) {
    [self finish:state code:@"WEB_UPSTREAM_FAILED" message:@"The page returned an invalid response." result:nil];
    return;
  }

  NSString *body = MiraDecodeBody(state.data ?: [NSData data], state.contentType ?: @"text/plain");
  NSURL *finalURL = task.response.URL ?: state.currentURL;
  NSDictionary *result = @{
    @"status": @(state.status),
    @"finalUrl": finalURL.absoluteString ?: @"",
    @"contentType": state.contentType ?: @"text/plain",
    @"body": body,
    @"truncated": @NO,
    @"redirectCount": @(state.redirects),
  };
  [self finish:state code:nil message:nil result:result];
}

@end
