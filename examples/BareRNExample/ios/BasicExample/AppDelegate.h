#import <RCTDefaultReactNativeFactoryDelegate.h>
#import <RCTReactNativeFactory.h>
#import <UIKit/UIKit.h>

@interface ReactNativeDelegate : RCTDefaultReactNativeFactoryDelegate
@end

@interface AppDelegate : UIResponder <UIApplicationDelegate>
@property (nonatomic, strong) RCTReactNativeFactory *reactNativeFactory;
@property (nonatomic, strong) ReactNativeDelegate *reactNativeDelegate;
@end

// Apps built with the iOS 27 SDK must use the scene lifecycle, so the window lives
// in the scene and React Native starts there.
@interface SceneDelegate : UIResponder <UIWindowSceneDelegate>
@property (nonatomic, strong) UIWindow *window;
@end
