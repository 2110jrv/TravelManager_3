const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderSettings({profile,authUser,access,remoteStatus='online',trip}={}){
  const role=access?.role||'VIEWER';
  return `<section class="section-head"><div><span class="eyebrow">CUENTA Y VIAJE</span><h2>Configuración</h2></div></section>
  <div class="settings-stack">
    <details class="settings-section" open><summary>Viaje</summary><div class="settings-body"><strong>${esc(trip?.name||'Italy October/November 2026')}</strong><span>20 oct – 5 nov 2026 · Jonathan & Jennifer</span></div></details>
    <details class="settings-section" open><summary>Cuenta</summary><div class="settings-body"><dl class="settings-list"><div><dt>Nombre</dt><dd>${esc(profile?.display_name||'')}</dd></div><div><dt>Email</dt><dd>${esc(authUser?.email||profile?.email||'')}</dd></div><div><dt>Rol</dt><dd><span class="role-pill">${esc(role)}</span></dd></div></dl><p class="admin-security-note">El PIN de acceso solo puede asignarlo o restablecerlo un administrador.</p></div></details>
    <details class="settings-section"><summary>Apariencia</summary><div class="settings-body"><label class="setting-select">Tamaño de texto<select data-text-scale><option value="default">Predeterminado</option><option value="small">Pequeño</option><option value="large">Grande</option></select></label><label class="setting-toggle"><input type="checkbox" data-high-contrast> Alto contraste</label></div></details>
    <details class="settings-section" open><summary>Sincronización y dispositivo</summary><div class="settings-body"><span>Dispositivo: ${esc(access?.deviceState||'TRUSTED')}</span><span>Estado: ${esc(remoteStatus||'offline')}</span></div></details>
    <details class="settings-section"><summary>Recuperación WhatsApp</summary><div class="settings-body"><span class="status-pill">No configurado</span><p>Requiere un proveedor de WhatsApp Business compatible.</p></div></details>
    ${role==='ADMIN'?'<details class="settings-section" open><summary>Administración</summary><div class="settings-body"><button class="primary" data-view="admin-users">Usuarios</button><button class="secondary" data-view="admin">Dispositivos y auditoría</button></div></details>':''}
  </div>`;
}
