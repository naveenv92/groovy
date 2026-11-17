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
    init(defaults:UserDefaults,account:@escaping()->String?,send:@escaping(Snapshot,@escaping(Bool)->Void)->Void){self.defaults=defaults;self.account=account;self.send=send}
    @discardableResult func enqueue(_ snapshot:Snapshot)->Bool {
        guard let account=account(),let id=snapshot["id"] as? String else{return false}
        var values=pending;values[account+"|"+id]=snapshot;pending=values
        return true
    }
    func clear(){pending=[:]}
    func flush(completion:((Bool)->Void)?=nil){
        if let completion {waiters.append(completion)}
        guard !sending else{return}
        guard let account=account() else{finish(false);return}
        guard let entry=pending.first(where:{$0.key.hasPrefix(account+"|")}) else{finish(true);return}
        sending=true
        send(entry.value){success in
            self.sending=false
            guard success,self.account()==account else{self.finish(false);return}
            var values=self.pending
            if NSDictionary(dictionary:values[entry.key] ?? [:]).isEqual(to:entry.value){values.removeValue(forKey:entry.key)}
            self.pending=values;self.flush()
        }
    }
    private func finish(_ success:Bool){let callbacks=waiters;waiters=[];callbacks.forEach{$0(success)}}
}
