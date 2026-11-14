import XCTest
import AVFoundation
@testable import App

@MainActor
final class PlaybackTests:XCTestCase {
    func testExplicitPauseCancelsInterruptionResume() {
        let audio=NativeAudio.shared
        audio.interrupted=true
        audio.pause()
        XCTAssertFalse(audio.interrupted)
        XCTAssertEqual(audio.player.rate,0)
    }
    func testRejectsNonNetworkAudioURLs() {
        let audio=NativeAudio.shared
        for source in ["file:///private/example.mp3","javascript:alert(1)","data:audio/mp3;base64,AAA"] {
            XCTAssertThrowsError(try audio.load(["episode":["id":"test","audio":source],"podcast":[:]],back:15,forward:30))
        }
    }
    func testProgressSnapshotsKeepIdentityAndCompletion() {
        let audio=NativeAudio.shared
        var snapshots:[[String:Any]]=[]
        audio.player.replaceCurrentItem(with:nil)
        audio.id="test"
        audio.item=["episode":["id":"test","title":"Episode","duration":100,"description":"Long description","date":"today"],"podcast":["url":"https://example.org/rss","title":"Show"]]
        audio.save={snapshots.append($0)}
        defer{audio.save=nil;audio.id="";audio.item=[:]}
        audio.publish(saveNow:true)
        audio.publish(ended:true)
        XCTAssertEqual(snapshots.count,2)
        XCTAssertEqual(snapshots[0]["id"] as? String,"test")
        XCTAssertEqual(snapshots[0]["completed"] as? Bool,false)
        XCTAssertEqual(snapshots[1]["completed"] as? Bool,true)
        let playback=snapshots[0]["playback"] as? [String:Any]
        let episode=playback?["episode"] as? [String:Any]
        XCTAssertEqual(episode?["duration"] as? Int,100)
        XCTAssertEqual(episode?["description"] as? String,"")
    }
    func testPausedObserverUpdatesDoNotKeepSaving() {
        let audio=NativeAudio.shared
        audio.player.replaceCurrentItem(with:nil);audio.id="test";audio.item=["episode":["id":"test"],"podcast":[:]];audio.wasPaused=true
        var count=0;audio.save={_ in count+=1}
        defer{audio.save=nil;audio.id="";audio.item=[:]}
        audio.publish();audio.publish()
        XCTAssertEqual(count,0)
    }
}
