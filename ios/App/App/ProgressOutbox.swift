import Foundation

final class ProgressOutbox {
    typealias Snapshot = [String:Any]
    private let defaults:UserDefaults
    private let account:()->String?
    private let send:(Snapshot,@escaping(Bool)->Void)->Void
    private var sending=false
    private var waiters:[(Bool)->Void]=[]
    private var pending:[String:Snapshot] {
        get {defaults.dictionary(forKey:"groovy.pending") as? [String:Snapshot] ?? [:]}
        set {defaults.set(newValue,forKey:"groovy.pending")}
    }
    var count:Int {pending.count}
    var hasPendingForCurrentAccount:Bool {guard let account=account() else{return false};return pending.keys.contains{$0.hasPrefix(account+"|")}}
    init(defaults:UserDefaults,account:@escaping()->String?,send:@escaping(Snapshot,@escaping(Bool)->Void)->Void){self.defaults=defaults;self.account=account;self.send=send}
    @discardableResult func enqueue(_ snapshot:Snapshot)->Bool {
        guard let account=account(),let id=snapshot["id"] as? String else{return false}
        var values=pending;values[account+"|"+id]=Self.compact(snapshot);pending=values
        return true
    }
    func clear(){pending=[:]}
    func flush(completion:((Bool)->Void)?=nil){
        if let completion {waiters.append(completion)}
        guard !sending else{return}
        guard let account=account() else{finish(false);return}
        guard let entry=pending.first(where:{$0.key.hasPrefix(account+"|")}) else{finish(true);return}
        // Older app versions queued entire feeds; repair those records before retrying.
        let snapshot=Self.compact(entry.value)
        var repaired=pending;repaired[entry.key]=snapshot;pending=repaired
        sending=true
        send(snapshot){success in
            self.sending=false
            guard success,self.account()==account else{self.finish(false);return}
            var values=self.pending
            if NSDictionary(dictionary:values[entry.key] ?? [:]).isEqual(to:snapshot){values.removeValue(forKey:entry.key)}
            self.pending=values;self.flush()
        }
    }
    private static func compact(_ snapshot:Snapshot)->Snapshot {
        guard let playback=snapshot["playback"] as? Snapshot,let episode=playback["episode"] as? Snapshot,let podcast=playback["podcast"] as? Snapshot else{return snapshot}
        var result=snapshot
        var details=episode.filter{["id","title","audio","artwork","duration"].contains($0.key)}
        details["description"]="";details["date"]=""
        result["playback"]=["episode":details,"podcast":podcast.filter{["url","title","author","artwork"].contains($0.key)}]
        return result
    }
    private func finish(_ success:Bool){let callbacks=waiters;waiters=[];callbacks.forEach{$0(success)}}
}
