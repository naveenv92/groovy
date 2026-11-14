import Foundation
import Capacitor
import Security

final class GroovyViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(GroovyPlugin()) }
}

@objc(GroovyPlugin)
final class GroovyPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionTaskDelegate {
    let identifier = "GroovyPlugin"
    let jsName = "Groovy"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "command", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "pendingProgress", returnType: CAPPluginReturnPromise)].compactMap{$0}
    private var account:String? {get{UserDefaults.standard.string(forKey:"groovy.account")} set{UserDefaults.standard.set(newValue,forKey:"groovy.account")}}
    private var pending:[String:[String:Any]] {get{UserDefaults.standard.dictionary(forKey:"groovy.pending") as? [String:[String:Any]] ?? [:]} set{UserDefaults.standard.set(newValue,forKey:"groovy.pending")}}
    private var sending=false
    private var waiters:[()->Void]=[]
    private func finishFlush(){let callbacks=waiters;waiters=[];callbacks.forEach{$0()}}
    override func load(){
        NativeAudio.shared.emit = {[weak self] state in self?.notifyListeners("state",data:state)}
        NativeAudio.shared.save = {[weak self] snapshot in self?.enqueue(snapshot)}
        NotificationCenter.default.addObserver(forName:UIApplication.didBecomeActiveNotification,object:nil,queue:.main){[weak self] _ in self?.flush();NativeAudio.shared.publish()}
    }
    @objc func pendingProgress(_ call:CAPPluginCall){waiters.append{call.resolve(["count":self.pending.count])};flush()}
    @objc func snapshot(_ call:CAPPluginCall){
        let audio=NativeAudio.shared
        call.resolve(["item":audio.id.isEmpty ? NSNull():audio.item,"position":audio.player.currentTime().seconds.isFinite ? audio.player.currentTime().seconds:0,"playing":audio.player.rate>0])
    }
    private func enqueue(_ snapshot:[String:Any]) {
        guard let account,let id=snapshot["id"] as? String else{return}
        var values=pending;values[account+"|"+id]=snapshot;pending=values;flush()
    }
    private func flush(){
        guard !sending else{return}
        guard let account,let token=credential(),let entry=pending.first(where:{$0.key.hasPrefix(account+"|")}) else{finishFlush();return}
        sending=true
        var request=URLRequest(url:URL(string:origin+"/api/progress")!);request.httpMethod="PUT"
        request.setValue(origin,forHTTPHeaderField:"Origin");request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.setValue("session="+token,forHTTPHeaderField:"Cookie")
        request.httpBody=try? JSONSerialization.data(withJSONObject:entry.value)
        session.dataTask(with:request){_,response,_ in DispatchQueue.main.async {
            self.sending=false
            guard let response=response as? HTTPURLResponse,response.statusCode==200,self.account==account else{self.finishFlush();return}
            var values=self.pending
            if NSDictionary(dictionary:values[entry.key] ?? [:]).isEqual(to:entry.value){values.removeValue(forKey:entry.key)}
            self.pending=values;self.flush()
        }}.resume()
    }
    private let origin = "https://groovy.naveen-venkatesan.workers.dev"
    private var key: [String: Any] { [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"com.naveenv92.groovy",kSecAttrAccount as String:"session"] }
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()
    private func credential() -> String? {
        var query=key; query[kSecReturnData as String]=true
        var value:CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary,&value)==errSecSuccess, let data=value as? Data else { return nil }
        return String(data:data,encoding:.utf8)
    }
    private func store(_ token:String?) throws {
        let deleted=SecItemDelete(key as CFDictionary)
        guard deleted==errSecSuccess || deleted==errSecItemNotFound else { throw NSError(domain:"Keychain",code:Int(deleted)) }
        if let token {
            var query=key; query[kSecValueData as String]=Data(token.utf8)
            query[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let status=SecItemAdd(query as CFDictionary,nil)
            guard status==errSecSuccess else { throw NSError(domain:"Keychain",code:Int(status)) }
        }
    }
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void) { completionHandler(nil) }
    @objc func request(_ call:CAPPluginCall) {
        if call.getString("path")=="me" {waiters.append{self.performRequest(call)};flush()}else{performRequest(call)}
    }
    private func performRequest(_ call:CAPPluginCall) {
        guard let path=call.getString("path"),let method=call.getString("method"),["GET","POST","PUT","DELETE"].contains(method),let url=URL(string:origin+"/api/"+path),url.scheme=="https",url.host=="groovy.naveen-venkatesan.workers.dev",url.path.hasPrefix("/api/"),!path.contains(".."),!path.hasPrefix("/") else { call.reject("Invalid API request.");return }
        if path=="progress",method=="PUT",let data=call.getObject("data") {if data["id"] as? String == NativeAudio.shared.id {NativeAudio.shared.player.pause();NativeAudio.shared.id=""};enqueue(data);call.resolve(["status":200,"data":["ok":true]]);return}
        if path=="logout" {NativeAudio.shared.pause();if !pending.isEmpty && call.getObject("data")?["discardPending"] as? Bool != true {call.reject("Progress is still waiting to sync. Please retry sign out when connected.");flush();return}}
        var request=URLRequest(url:url); request.httpMethod=method
        request.setValue(origin,forHTTPHeaderField:"Origin")
        request.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if let token=credential() {request.setValue("session="+token,forHTTPHeaderField:"Cookie")}
        do {if let data=call.getObject("data") {request.httpBody=try JSONSerialization.data(withJSONObject:data)}} catch {call.reject("Invalid request body.");return}
        session.dataTask(with:request){data,response,error in
            guard error==nil,let response=response as? HTTPURLResponse,let data else {call.reject("Could not connect to Groovy.");return}
            do {
                if path=="logout" && response.statusCode==200 || response.statusCode==401 {try self.store(nil)}
                if path=="login",response.statusCode==200 {
                    let fields=response.allHeaderFields.reduce(into:[String:String]()){result,item in result[String(describing:item.key)]=String(describing:item.value)}
                    guard let cookie=HTTPCookie.cookies(withResponseHeaderFields:fields,for:url).first(where:{$0.name=="session"}) else {call.reject("Missing login session.");return}
                    try self.store(cookie.value)
                }
                let result=try JSONSerialization.jsonObject(with:data)
                if path=="me",response.statusCode==200,(result as? [String:Any])?["accountId"] as? String == nil {call.reject("Update the Groovy server before using the native app.");return}
                if path=="me",response.statusCode==200,let value=result as? [String:Any],let account=value["accountId"] as? String {
                    DispatchQueue.main.async {self.account=account;self.flush()}
                }
                if path=="logout",response.statusCode==200 {DispatchQueue.main.async{self.account=nil;self.pending=[:];NativeAudio.shared.player.pause();NativeAudio.shared.id="";MPNowPlayingInfoCenter.default().nowPlayingInfo=nil}}
                call.resolve(["status":response.statusCode,"data":result])
            } catch {call.reject("Could not process the API response.",nil,error)}
        }.resume()
    }
}

import AVFoundation
import MediaPlayer

final class NativeAudio {
    static let shared = NativeAudio()
    let player=AVPlayer()
    var item:[String:Any] = [:]
    var id="",speed:Float=1,back:Double=15,forward:Double=30
    var save:(([String:Any])->Void)?
    var wasPaused=true
    var lastSaved=Date.distantPast
    var emit:(([String:Any])->Void)?
    var itemObservations:[NSKeyValueObservation]=[]
    var observation:NSKeyValueObservation?
    var interrupted=false
    init(){
        player.addPeriodicTimeObserver(forInterval:CMTime(seconds:1,preferredTimescale:600),queue:.main){[weak self] _ in self?.publish()}
        observation=player.observe(\.timeControlStatus,options:[.new]){[weak self] _,_ in DispatchQueue.main.async{self?.publish()}}
        NotificationCenter.default.addObserver(forName:.AVPlayerItemDidPlayToEndTime,object:nil,queue:.main){[weak self] notification in
            guard let self,notification.object as? AVPlayerItem === self.player.currentItem else{return}
            self.publish(ended:true)
        }
        NotificationCenter.default.addObserver(forName:AVAudioSession.routeChangeNotification,object:nil,queue:.main){[weak self] notification in
            if notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {self?.pause()}
        }
        NotificationCenter.default.addObserver(forName:AVAudioSession.interruptionNotification,object:nil,queue:.main){[weak self] notification in
            guard let self,let type=notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else{return}
            if type==AVAudioSession.InterruptionType.began.rawValue{self.interrupted=self.player.rate>0;self.player.pause()}
            else {let options=notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0;if self.interrupted && AVAudioSession.InterruptionOptions(rawValue:options).contains(.shouldResume){try? self.play()};self.interrupted=false}
        }
        let commands=MPRemoteCommandCenter.shared()
        commands.playCommand.addTarget{[weak self] _ in do{try self?.play();return .success}catch{return .commandFailed}}
        commands.pauseCommand.addTarget{[weak self] _ in self?.pause();return .success}
        commands.togglePlayPauseCommand.addTarget{[weak self] _ in guard let self else{return .commandFailed};if self.player.rate>0{self.pause()}else{try? self.play()};return .success}
        commands.skipBackwardCommand.addTarget{[weak self] _ in self?.skip(-1);return .success}
        commands.skipForwardCommand.addTarget{[weak self] _ in self?.skip(1);return .success}
        commands.previousTrackCommand.addTarget{[weak self] _ in self?.skip(-1);return .success}
        commands.nextTrackCommand.addTarget{[weak self] _ in self?.skip(1);return .success}
        commands.changePlaybackPositionCommand.addTarget{[weak self] event in guard let event=event as? MPChangePlaybackPositionCommandEvent else{return .commandFailed};self?.seek(event.positionTime);return .success}
    }
    func pause(){interrupted=false;let active=player.timeControlStatus != .paused;player.pause();if active{publish(saveNow:true)}}
    func play() throws {
        guard player.currentItem != nil else{return}
        try AVAudioSession.sharedInstance().setCategory(.playback,mode:.spokenAudio)
        try AVAudioSession.sharedInstance().setActive(true)
        player.playImmediately(atRate:speed)
    }
    func seek(_ value:Double){guard value.isFinite else{return};let duration=player.currentItem?.duration.seconds ?? .infinity;player.seek(to:CMTime(seconds:max(0,min(value,duration.isFinite ? duration : value)),preferredTimescale:600)){_ in self.publish(saveNow:true)}}
    func skip(_ direction:Double){seek(player.currentTime().seconds+direction*(direction<0 ? back:forward))}
    func publish(ended:Bool=false,saveNow:Bool=false){
        guard !id.isEmpty else{return}
        let position=player.currentTime().seconds,duration=player.currentItem?.duration.seconds ?? 0
        let state:[String:Any] = ["id":id,"position":position.isFinite ? position:0,"duration":duration.isFinite ? duration:0,"paused":player.rate==0,"ended":ended,"buffering":player.timeControlStatus == .waitingToPlayAtSpecifiedRate,"error":player.currentItem?.error?.localizedDescription ?? ""]
        emit?(state)
        if saveNow || ended || (player.rate==0 && !wasPaused) || (player.rate>0 && Date().timeIntervalSince(lastSaved)>=10) {
            lastSaved=Date()
            if var episode=item["episode"] as? [String:Any],let podcast=item["podcast"] as? [String:Any] {
                episode["duration"]=duration.isFinite && duration>0 ? duration : episode["duration"]
                episode["description"]="";episode["date"]=""
                save?(["id":id,"position":position.isFinite ? position:0,"completed":ended,"playback":["episode":episode,"podcast":podcast]])
            }
        }
        wasPaused=player.rate==0
        var info=MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime]=position.isFinite ? position:0
        info[MPMediaItemPropertyPlaybackDuration]=duration.isFinite ? duration:0
        info[MPNowPlayingInfoPropertyPlaybackRate]=player.rate
        MPNowPlayingInfoCenter.default().nowPlayingInfo=info
        if ended {id="";player.replaceCurrentItem(with:nil);MPNowPlayingInfoCenter.default().nowPlayingInfo=nil;try? AVAudioSession.sharedInstance().setActive(false,options:.notifyOthersOnDeactivation)}
    }
    func load(_ value:[String:Any],back:Double,forward:Double) throws {
        guard let episode=value["episode"] as? [String:Any],let podcast=value["podcast"] as? [String:Any],let id=episode["id"] as? String,let source=episode["audio"] as? String,let url=URL(string:source),["https","http"].contains(url.scheme ?? "") else{throw NSError(domain:"Playback",code:1)}
        publish(saveNow:true);player.pause();self.id=id;item=value;self.back=back;self.forward=forward
        let audio=AVPlayerItem(url:url);audio.audioTimePitchAlgorithm = .timeDomain;player.replaceCurrentItem(with:audio)
        itemObservations=[audio.observe(\.duration,options:[.new]){[weak self] _,_ in DispatchQueue.main.async{self?.publish()}},audio.observe(\.status,options:[.new]){[weak self] _,_ in DispatchQueue.main.async{self?.publish()}}]
        MPRemoteCommandCenter.shared().skipBackwardCommand.preferredIntervals=[NSNumber(value:back)]
        MPRemoteCommandCenter.shared().skipForwardCommand.preferredIntervals=[NSNumber(value:forward)]
        MPNowPlayingInfoCenter.default().nowPlayingInfo=[MPMediaItemPropertyTitle:episode["title"] as? String ?? "",MPMediaItemPropertyArtist:podcast["title"] as? String ?? "",MPMediaItemPropertyAlbumTitle:podcast["title"] as? String ?? ""]
        let art=(episode["artwork"] as? String).flatMap{$0.isEmpty ? nil:$0} ?? podcast["artwork"] as? String ?? ""
        if let url=URL(string:art),url.scheme=="https" {URLSession.shared.dataTask(with:url){data,_,_ in guard let data,let image=UIImage(data:data) else{return};DispatchQueue.main.async{guard self.id==id else{return};var info=MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:];info[MPMediaItemPropertyArtwork]=MPMediaItemArtwork(boundsSize:image.size){_ in image};MPNowPlayingInfoCenter.default().nowPlayingInfo=info}}.resume()}
    }
}

extension GroovyPlugin {
    @objc func command(_ call:CAPPluginCall){
        DispatchQueue.main.async {
            let audio=NativeAudio.shared
            audio.save = {[weak self] snapshot in self?.enqueue(snapshot)}
            audio.emit = {[weak self] state in self?.notifyListeners("state",data:state)}
            do {
                switch call.getString("action") {
                case "load":try audio.load(call.getObject("item") ?? [:],back:call.getDouble("back") ?? 15,forward:call.getDouble("forward") ?? 30)
                case "play":try audio.play()
                case "pause":audio.pause()
                case "seek":audio.seek(call.getDouble("position") ?? 0)
                case "settings":
                    let back=call.getDouble("back") ?? 15,forward=call.getDouble("forward") ?? 30
                    guard back>=5 && back<=120 && forward>=5 && forward<=120 else{call.reject("Invalid skips");return}
                    audio.back=back;audio.forward=forward
                    MPRemoteCommandCenter.shared().skipBackwardCommand.preferredIntervals=[NSNumber(value:back)]
                    MPRemoteCommandCenter.shared().skipForwardCommand.preferredIntervals=[NSNumber(value:forward)]
                case "speed":let value=call.getFloat("speed") ?? 1;guard value>=0.5 && value<=2 else{call.reject("Invalid speed");return};audio.speed=value;if audio.player.rate>0{audio.player.rate=value}
                case "stop":audio.player.pause();audio.id="";audio.player.replaceCurrentItem(with:nil);MPNowPlayingInfoCenter.default().nowPlayingInfo=nil;try? AVAudioSession.sharedInstance().setActive(false,options:.notifyOthersOnDeactivation)
                default:call.reject("Unknown playback command");return
                }
                audio.publish();call.resolve()
            }catch{call.reject("Playback failed.",nil,error)}
        }
    }
}
