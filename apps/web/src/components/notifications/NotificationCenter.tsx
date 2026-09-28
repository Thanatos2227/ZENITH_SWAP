import React from 'react';
import { useZenithStore } from '../../stores/useZenithStore';
import { defaultChainRegistry } from '@zenith/chains';
import { X, Bell, CheckCircle2, AlertCircle, Info, CheckCheck } from 'lucide-react';
export const NotificationCenter: React.FC = () => {
    const { isNotificationDrawerOpen, toggleNotificationDrawer, notifications, markNotificationsAsRead } = useZenithStore();
    if (!isNotificationDrawerOpen)
        return null;
    return (<div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md h-full bg-[#080B11] border-l border-slate-800 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-cyan-400"/>
            <h3 className="font-display font-bold text-base text-white">Notifications</h3>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={markNotificationsAsRead} className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors text-xs flex items-center gap-1 font-semibold" title="Mark all as read">
              <CheckCheck className="w-4 h-4"/>
              <span className="hidden sm:inline">Read All</span>
            </button>
            <button onClick={toggleNotificationDrawer} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
              <X className="w-5 h-5"/>
            </button>
          </div>
        </div>

        <div className="flex-1 p-4 overflow-y-auto divide-y divide-slate-800/60 space-y-3">
          {notifications.length === 0 ? (<div className="text-center py-12 text-slate-500 text-sm">
              No recent notifications
            </div>) : (notifications.map((n) => (<div key={n.id} className={`pt-3 first:pt-0 flex items-start gap-3 text-xs ${!n.isRead ? 'opacity-100' : 'opacity-70'}`}>
                <div className="mt-0.5">
                  {n.type === 'SUCCESS' ? (<CheckCircle2 className="w-4 h-4 text-emerald-400"/>) : n.type === 'ERROR' ? (<AlertCircle className="w-4 h-4 text-red-400"/>) : (<Info className="w-4 h-4 text-cyan-400"/>)}
                </div>

                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white text-xs">{n.title}</span>
                      {n.chainId && defaultChainRegistry.getChain(n.chainId) && (<img src={defaultChainRegistry.getChain(n.chainId)?.iconURI} alt={n.chainId} className="w-3.5 h-3.5 rounded-full object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}/>)}
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-slate-400 text-xs">{n.message}</p>
                  {n.txHash && (<p className="font-mono text-[10px] text-cyan-400">
                      Tx: {n.txHash.slice(0, 10)}...{n.txHash.slice(-8)}
                    </p>)}
                </div>
              </div>)))}
        </div>
      </div>
    </div>);
};
