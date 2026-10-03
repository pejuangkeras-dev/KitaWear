(()=>{"use strict";
async function g7RefreshChatUnread(){
 if(!window.kwSupabase||!window.kwCurrentUser)return;
 try{
  const {data,error}=await window.kwSupabase.rpc("get_chat_unread_count");
  if(error)throw error;
  const btn=document.querySelector('[data-account-section="messages"]');
  if(!btn)return;
  let badge=btn.querySelector(".g7-chat-unread");
  const n=Number(data||0);
  if(n>0){
   if(!badge){badge=document.createElement("span");badge.className="g7-chat-unread notification-unread-badge";btn.appendChild(badge);}
   badge.textContent=n>99?"99+":String(n);badge.style.display="inline-flex";
  }else if(badge) badge.style.display="none";
 }catch(e){console.warn("G7 chat unread:",e.message||e)}
}
function g7ChatRealtime(){
 if(!window.kwSupabase||!window.kwCurrentUser||window.g7ChatChannel)return;
 window.g7ChatChannel=window.kwSupabase.channel("marketkita-g7-chat-"+window.kwCurrentUser.id)
  .on("postgres_changes",{event:"INSERT",schema:"public",table:"chat_messages"},()=>g7RefreshChatUnread())
  .on("postgres_changes",{event:"UPDATE",schema:"public",table:"chat_messages"},()=>g7RefreshChatUnread())
  .subscribe();
}
window.g7RefreshChatUnread=g7RefreshChatUnread;
document.addEventListener("DOMContentLoaded",()=>setTimeout(()=>{g7RefreshChatUnread();g7ChatRealtime()},1300));
const style=document.createElement("style");style.textContent=".g7-chat-unread{margin-left:6px!important}";document.head.appendChild(style);
})();