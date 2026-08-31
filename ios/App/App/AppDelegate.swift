import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureAudioSession()
        return true
    }

    /**
     * The audio session, which is the half of "왜 소리가 안 나" that no amount of
     * Web Audio can reach.
     *
     * Capacitor sets no category at all, so the app inherits `.soloAmbient`:
     * the ring/silent switch silences it, and it stops whatever the user was
     * listening to. Both are wrong here, and the fix is one call.
     *
     * `.playback` is what makes the game audible with the mute switch on. That
     * switch is the single most common "no sound on iPhone" report, it cannot be
     * read from JavaScript — there is no API, on any iOS version — and so it
     * cannot be warned about either. Choosing a category that ignores it is not
     * a workaround for the detection problem; it is the only actual answer to it.
     *
     * `.mixWithOthers` is the other half. `.playback` alone claims the route and
     * kills the podcast the player already had going. With this option the game
     * lays its own sound over whatever is playing and takes nothing away.
     *
     * Failure here is not fatal and must not be: a session that will not
     * configure still leaves a game that plays, just a quieter one.
     */
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            print("[audio] session setup failed: \(error)")
        }

        /**
         * Coming back from an interruption.
         *
         * A call, Siri or another app taking the route deactivates the session,
         * and iOS does NOT reactivate it on the way out — the app has to ask.
         * Until it does, the page's AudioContext sits in WebKit's non-standard
         * `'interrupted'` state and nothing it schedules is heard.
         *
         * This is the native half of that recovery; the web half is in
         * src/audio/Mixer.js, where `needsResume` treats `'interrupted'` as
         * resumable. Both are needed: reactivating the session without resuming
         * the context leaves the context stopped, and resuming the context
         * without an active session gives it nowhere to play.
         */
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: session
        )
    }

    @objc private func handleAudioInterruption(_ note: Notification) {
        guard
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw),
            type == .ended
        else { return }

        // `.shouldResume` is iOS saying the interrupting audio is finished and
        // it is our turn again. Reactivating when it is absent — during a call
        // that is still in progress — throws and is the wrong thing to do.
        let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt).map {
            AVAudioSession.InterruptionOptions(rawValue: $0)
        }
        guard options?.contains(.shouldResume) == true else { return }

        try? AVAudioSession.sharedInstance().setActive(true)
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
