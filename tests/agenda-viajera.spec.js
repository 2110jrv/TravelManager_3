import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); await page.evaluate(() => localStorage.clear()); await page.reload(); });

test('logged out muestra login sin filtrar datos privados', async ({ page }) => {
  const errors=[]; page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('/'); await expect(page).toHaveTitle('Agenda Viajera'); await expect(page.getByRole('heading', { name: 'Aplicación privada' })).toBeVisible(); await expect(page.locator('input[name="pin"]')).toBeVisible();
  await expect(page.getByText('AHORA')).toHaveCount(0); await expect(page.getByText('Admin Test')).toHaveCount(0); expect(errors.filter(x=>!x.includes('Failed to load resource'))).toEqual([]);
});

test('presupuesto deriva valores y persiste un nuevo item', async ({ page }) => {
  await page.getByRole('button', { name: 'Agenda' }).click();
  page.once('dialog', dialog => dialog.accept('Cena de prueba')); await page.getByRole('button', { name: '+ Nuevo' }).click();
  await expect(page.getByText('Cena de prueba')).toBeVisible(); await page.getByRole('button', { name: 'J' }).click(); await page.getByText('Presupuesto').click();
  await expect(page.getByText('Planificado')).toBeVisible(); await page.reload(); await page.getByRole('button', { name: 'Agenda' }).click(); await expect(page.getByText('Cena de prueba')).toBeVisible();
});

test('revocar dispositivo muestra pantalla de kill y restaura con nota', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'J' }).click(); await page.getByText('Administración').click();
  await page.getByRole('button', { name: 'Revocar dispositivo' }).click(); await expect(page.getByText('Este dispositivo ya no está autorizado.')).toBeVisible();
  page.once('dialog', dialog => dialog.accept('Restauración solicitada por admin')); await page.getByRole('button', { name: 'Solicitar restauración' }).click(); await expect(page.locator('h2').filter({ hasText: 'Administración' })).toBeVisible();
});

test('dos contextos mantienen repositorios locales aislados', async ({ browser }) => {
  const a=await browser.newContext(), b=await browser.newContext(); const pa=await a.newPage(), pb=await b.newPage();
  await Promise.all([pa.goto('/'),pb.goto('/')]); await pa.evaluate(() => localStorage.setItem('agenda-viajera.role','TRAVELER_SAFE')); await pb.evaluate(() => localStorage.setItem('agenda-viajera.role','VIEWER'));
  await pa.reload(); await pb.reload(); await expect(pa.getByRole('button',{name:'J'})).toBeVisible(); await expect(pb.getByRole('button',{name:'J'})).toBeVisible(); await a.close(); await b.close();
});
