// M0 simulator-only probe. Synthetic audio, loopback-only HTTP, fake credentials.
// This is not the production loader, authentication flow, or product UI.
import SwiftUI
import AVFoundation
import MediaPlayer
import AuthenticationServices
import Security

func record(_ name:String,_ value:Any) {
    let url=FileManager.default.urls(for:.documentDirectory,in:.userDomainMask)[0].appendingPathComponent("probe.jsonl")
    let data=(String(data:try! JSONSerialization.data(withJSONObject:["event":name,"value":value]),encoding:.utf8)!+"\n").data(using:.utf8)!
    if !FileManager.default.fileExists(atPath:url.path) { FileManager.default.createFile(atPath:url.path,contents:nil) }
    let f=try! FileHandle(forWritingTo:url);try! f.seekToEnd();try! f.write(contentsOf:data);try! f.close()
}
final class Loader:NSObject,AVAssetResourceLoaderDelegate,URLSessionTaskDelegate {
    let q=DispatchQueue(label:"m0.loader")
    var active:[ObjectIdentifier:URLSessionDataTask]=[:]
    var cancelled=false
    lazy var session:URLSession = {
        let config=URLSessionConfiguration.ephemeral
        config.urlCache=nil;config.httpCookieStorage=nil;config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest=5
        return URLSession(configuration:config,delegate:self,delegateQueue:nil)
    }()
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){completionHandler(nil)}
    func resourceLoader(_ loader:AVAssetResourceLoader,shouldWaitForLoadingOfRequestedResource r:AVAssetResourceLoadingRequest)->Bool{
        guard !cancelled, r.request.url?.scheme=="m0audio" else{return false}
        let id=ObjectIdentifier(r)
        var req=URLRequest(url:URL(string:"http://127.0.0.1:18761/audio")!)
        req.httpMethod="HEAD";req.setValue("Bearer fixture-a-s1",forHTTPHeaderField:"Authorization")
        let task=session.dataTask(with:req){_,res,error in self.q.async {
            guard !self.cancelled,!r.isCancelled else{return}
            guard let h=res as? HTTPURLResponse,h.statusCode==200,error==nil, h.expectedContentLength>0 else {r.finishLoading(with:error ?? NSError(domain:"head",code:1));return}
            r.contentInformationRequest?.contentType="public.mp3"
            r.contentInformationRequest?.contentLength=h.expectedContentLength
            r.contentInformationRequest?.isByteRangeAccessSupported=true
            guard let d=r.dataRequest else {r.finishLoading();self.active.removeValue(forKey:id);return}
            let start=max(d.requestedOffset,d.currentOffset)
            let end=d.requestsAllDataToEndOfResource ? h.expectedContentLength : min(h.expectedContentLength,d.requestedOffset+Int64(d.requestedLength))
            self.chunk(r,start:start,end:end)
        }}
        active[id]=task;task.resume();return true
    }
    func chunk(_ r:AVAssetResourceLoadingRequest,start:Int64,end:Int64){
        let id=ObjectIdentifier(r)
        guard !cancelled,!r.isCancelled else{return}
        guard start<end else{r.finishLoading();active.removeValue(forKey:id);return}
        let stop=min(end-1,start+32767)
        var req=URLRequest(url:URL(string:"http://127.0.0.1:18761/audio")!)
        req.setValue("Bearer fixture-a-s1",forHTTPHeaderField:"Authorization")
        req.setValue("bytes=\(start)-\(stop)",forHTTPHeaderField:"Range")
        let task=session.dataTask(with:req){data,res,error in self.q.async {
            guard !self.cancelled,!r.isCancelled else{return}
            guard error==nil, let h=res as? HTTPURLResponse,h.statusCode==206,let data,Int64(data.count)==stop-start+1,
                  h.value(forHTTPHeaderField:"Content-Range")?.hasPrefix("bytes \(start)-\(stop)/")==true else{
                r.finishLoading(with:error ?? NSError(domain:"range",code:2));self.active.removeValue(forKey:id);return
            }
            r.dataRequest?.respond(with:data)
            self.chunk(r,start:stop+1,end:end)
        }}
        active[id]=task;task.resume()
    }
    func resourceLoader(_ loader:AVAssetResourceLoader,didCancel r:AVAssetResourceLoadingRequest){active.removeValue(forKey:ObjectIdentifier(r))?.cancel();record("av_cancel",true)}
    func stop(){q.async {self.cancelled=true;self.active.values.forEach{$0.cancel()};self.active.removeAll();self.session.invalidateAndCancel();record("loads_cancelled",true)}}
}
@MainActor final class Probe:ObservableObject {
    let player=AVPlayer();let loader=Loader();var observation:NSKeyValueObservation?;var deadlineTask:Task<Void,Never>?
    @Published var message="M0 原生媒体实验（合成音频）"
    func run(){
        do {try AVAudioSession.sharedInstance().setCategory(.playback,mode:.default);try AVAudioSession.sharedInstance().setActive(true);record("audio_session",true)}catch{record("audio_session",false)}
        // API compile proof only; this does not start or validate a real HTTPS callback.
        _ = ASWebAuthenticationSession.Callback.https(host:"wwwstationcat.org",path:"/auth/mobile/callback")
        record("https_callback_constructed",true)
        keychainProbe()
        let asset=AVURLAsset(url:URL(string:"m0audio://fixture/song.mp3")!)
        asset.resourceLoader.setDelegate(loader,queue:loader.q)
        let item=AVPlayerItem(asset:asset)
        observation=item.observe(\.status,options:[.new]){item,_ in
            record("item_status",item.status.rawValue)
            if let error=item.error {record("player_error",error.localizedDescription)}
        }
        player.replaceCurrentItem(with:item);player.volume=0 // avoid unsolicited audible tone
        MPRemoteCommandCenter.shared().pauseCommand.addTarget{[weak self]_ in Task{@MainActor in self?.player.pause()};return .success}
        MPNowPlayingInfoCenter.default().nowPlayingInfo=[MPMediaItemPropertyTitle:"M0 synthetic fixture",MPNowPlayingInfoPropertyPlaybackRate:1]
        record("remote_controls_registered",true)
        player.play()
        // Monotonic deadline independent of deliberately hanging authorization request.
        let clock=ContinuousClock();let boundary=clock.now.advanced(by:.seconds(3))
        deadlineTask=Task{[weak self] in
            try? await clock.sleep(until:boundary)
            guard !Task.isCancelled,let self else{return}
            record("buffered_to",self.player.currentItem?.loadedTimeRanges.last.map { CMTimeRangeGetEnd($0.timeRangeValue).seconds } ?? 0)
            record("rate_before_stop",self.player.rate)
            record("time_before_stop",self.player.currentTime().seconds.isFinite ? self.player.currentTime().seconds : -1)
            self.player.pause();self.loader.stop();self.player.replaceCurrentItem(with:nil)
            MPNowPlayingInfoCenter.default().nowPlayingInfo=nil
            record("hard_stop",self.player.rate==0 && self.player.currentItem==nil)
            self.message="实验已停止，报告已保存"
        }
        var req=URLRequest(url:URL(string:"http://127.0.0.1:18761/hang")!);req.timeoutInterval=15
        URLSession.shared.dataTask(with:req){_,_,_ in record("late_permission_response",true)}.resume()
        Task{[weak self] in
            try? await Task.sleep(for:.seconds(1));guard let self else{return}
            record("playing_before_seek",self.player.rate>0 && self.player.currentTime().seconds>0)
            await self.player.seek(to:CMTime(seconds:0.5,preferredTimescale:600));record("seek_requested",true)
        }
    }
    func keychainProbe(){
        let base:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"org.stationcat.m0.fixture",kSecAttrAccount as String:"native-envelope"]
        SecItemDelete(base as CFDictionary)
        let old=Data(#"{"generation":0,"pending":"same-op","token":"fixture-only"}"#.utf8)
        var add=base;add[kSecValueData as String]=old;add[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let a=SecItemAdd(add as CFDictionary,nil)
        let next=Data(#"{"generation":1,"pending":null,"token":"fixture-next"}"#.utf8)
        let u=SecItemUpdate(base as CFDictionary,[kSecValueData as String:next] as CFDictionary)
        var query=base;query[kSecReturnData as String]=true;var result:CFTypeRef?
        let r=SecItemCopyMatching(query as CFDictionary,&result)
        record("keychain_status_codes",[a,u,r])
        record("simulator_keychain_atomic_item",a==errSecSuccess && u==errSecSuccess && r==errSecSuccess && result as? Data==next)
        SecItemDelete(base as CFDictionary)
    }
}
@main struct M0App:App{
    @StateObject var probe=Probe()
    var body:some Scene{WindowGroup{Text(probe.message).padding().task{probe.run()}}}
}
