import{test,expect}from'@playwright/test';import{readFileSync}from'node:fs';
test('staging fresh browser exposes only sign-in until device authorization',async({page,context})=>{
 await context.route('**/v2/',r=>r.fulfill({contentType:'text/html',body:readFileSync(new URL('../public/v2/index.html',import.meta.url),'utf8').replace('<html lang="es">','<html lang="es" data-av2-staging="true">')}));
 await context.route('https://cslludzuejkhsydqiabx.supabase.co/**',r=>r.abort());
 await page.goto('/v2/');await expect(page.getByRole('heading',{name:'Agenda Viajera 2.0',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Conectar Google'})).toBeVisible();await expect(page.locator('#app')).not.toContainText('Italia 2026');await page.getByRole('link',{name:'Itinerario'}).click();await expect(page.getByRole('heading',{name:'Agenda Viajera 2.0',exact:true})).toBeVisible();expect(await page.locator('.event-card').count()).toBe(0);
});
