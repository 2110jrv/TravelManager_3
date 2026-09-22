export function createActionRouter({agenda,navigation,access,render,admin,restore,login,chat,toggleAgenda,editAgenda,qrScan,qrShow,newAgenda}) {
  chat=chat||globalThis.__tm3Chat;
  return {
    async route(action,element) {
      const id=element.dataset.entryId;
      switch(action) {
        case 'chat-open-general': return chat.openConversation(`trip:1aafae82-4ff7-423b-ade2-25170e8b0dd4`);
        case 'chat-open-direct': return await chat.openDirect(element.dataset.userId||'b');
        case 'chat-send': return chat.sendMessage(new FormData(element).get('message'));
        case 'chat-retry': return chat.syncPendingMessages();
        case 'budget-jump': return navigation.navigateToEntry(element.dataset.entryId);
        case 'audit-jump': return navigation.navigateToEntry(element.dataset.entryId);
        case 'menu': return navigation.toggleMenu();
        case 'agenda-create': case 'new': return newAgenda?newAgenda(element.dataset.idea==='true'):agenda.create(element.dataset.idea==='true');
        case 'agenda-toggle': return toggleAgenda?.(id);
        case 'agenda-edit': case 'edit': return editAgenda?editAgenda(id):agenda.edit(id);
        case 'qr-scan': return qrScan?.(id,Number(element.dataset.passengerIndex||-1));
        case 'qr-show': return qrShow?.(id,Number(element.dataset.passengerIndex||-1));
        case 'agenda-detail': case 'detail': return agenda.detail(id);
        case 'agenda-duplicate': case 'duplicate': return agenda.duplicate(id,element.dataset.idea==='true');
        case 'agenda-move-to-idea': case 'move': return agenda.move(id,element.dataset.idea==='true');
        case 'agenda-move-to-agenda': return agenda.move(id,true);
        case 'agenda-cancel': case 'cancel': return agenda.cancel(id);
        case 'agenda-delete': return agenda.remove(id);
        case 'document-cache': return alert('Documento cacheado para este dispositivo');
        case 'document-purge': return alert('Copia offline marcada PURGE_PENDING');
        case 'device-kill':
        case 'device-revoke': access.revoke(); return render();
        case 'restore': return restore();
        case 'session-login': return login?.();
        default: if(action.startsWith('device-')||action.startsWith('restore-')||action.startsWith('conflict-')) return admin(element);
      }
    }
  };
}
