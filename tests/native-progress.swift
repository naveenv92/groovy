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
account="alice"
outbox.flush()
assert(requests.count==before+1)
replies.removeFirst()(true)
account=nil
assert(!outbox.enqueue(["id":"one","completed":true]),"Missing identity cannot acknowledge a saved marker")
print("Native progress queue checks passed")
