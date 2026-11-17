// Run against ProgressOutbox.swift with the Swift interpreter; no iOS simulator required.
let suite="groovy-progress-tests-"+UUID().uuidString
let defaults=UserDefaults(suiteName:suite)!
defer{defaults.removePersistentDomain(forName:suite)}
var account:String?="alice"
var requests:[[String:Any]]=[]
var replies:[(Bool)->Void]=[]
func makeOutbox()->ProgressOutbox {
    ProgressOutbox(defaults:defaults,account:{account},send:{snapshot,reply in requests.append(snapshot);replies.append(reply)})
}
var outbox=makeOutbox()
assert(outbox.enqueue(["id":"one","position":100,"completed":true]))
var confirmed:Bool?
outbox.flush{confirmed=$0}
assert(confirmed==nil,"Queued does not mean saved")
replies.removeFirst()(false)
assert(confirmed==false && outbox.count==1,"Failed saves must remain queued")
outbox=makeOutbox()
assert(outbox.count==1,"Recreating the app's queue must preserve failed markers")
outbox.flush{confirmed=$0}
assert(requests.last?["completed"] as? Bool==true)
replies.removeFirst()(true)
assert(confirmed==true && outbox.count==0,"Only server confirmation removes the marker")
assert(outbox.enqueue(["id":"one","position":100,"completed":true]))
outbox.flush()
assert(outbox.enqueue(["id":"one","position":0,"completed":false]))
replies.removeFirst()(true)
assert(outbox.count==1 && requests.last?["completed"] as? Bool==false,"An old response cannot remove a newer unplayed marker")
replies.removeFirst()(true)
assert(outbox.count==0)
assert(outbox.enqueue(["id":"one","position":100,"completed":true]))
account="bob"
let before=requests.count
outbox.flush()
assert(requests.count==before,"Another account cannot send Alice's markers")
assert(!outbox.hasPendingForCurrentAccount)
account="alice"
outbox.flush()
assert(requests.count==before+1)
replies.removeFirst()(true)
account=nil
assert(!outbox.enqueue(["id":"one","completed":true]),"Missing identity cannot acknowledge a saved marker")
account="alice"
let podcast:[String:Any] = ["url":"https://example.org/feed","title":"Show","author":"Author","artwork":"","episodes":Array(repeating:["description":String(repeating:"x",count:1000)],count:500),"description":"Long description"]
let episode:[String:Any] = ["id":"legacy","title":"Episode","audio":"https://example.org/audio.mp3","artwork":"","duration":120,"description":String(repeating:"x",count:20000)]
let huge:[String:Any] = ["id":"legacy","position":23,"completed":false,"playback":["episode":episode,"podcast":podcast]]
// Simulate an oversized entry persisted by an already installed version.
defaults.set(["alice|legacy":huge],forKey:"groovy.pending")
outbox=makeOutbox()
outbox.flush()
let repaired=requests.last!
assert(try! JSONSerialization.data(withJSONObject:repaired).count<1000,"Legacy feeds must be repaired below the server body limit")
let details=repaired["playback"] as! [String:Any]
assert((details["podcast"] as! [String:Any])["episodes"]==nil)
assert(repaired["position"] as? Int==23 && repaired["completed"] as? Bool==false)
replies.removeFirst()(true)
assert(outbox.count==0,"A repaired legacy entry must stop blocking the queue")
assert(outbox.enqueue(huge))
outbox.flush()
assert(try! JSONSerialization.data(withJSONObject:requests.last!).count<1000,"New entries must also stay compact")
replies.removeFirst()(true)
assert(outbox.count==0)
print("Native progress queue checks passed")
