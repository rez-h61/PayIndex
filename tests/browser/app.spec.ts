import { test, expect } from '@playwright/test';
test('no-login directory, search, person, QR and back navigation',async({page})=>{
 await page.goto('/?demo=1');
 await expect(page.getByRole('heading',{name:'Find your people.'})).toBeVisible();
 await expect(page.getByText('Fictional people · no real payment QRs')).toBeVisible();
 await expect(page.getByText('Continue with Google')).toHaveCount(0);
 await page.getByRole('searchbox',{name:'Search people'}).fill('alex');
 await expect(page.locator('.member-row')).toHaveCount(1);
 await page.locator('.member-row').click();
 await page.getByRole('button',{name:/Maybank Updated/}).click();
 await expect(page.getByRole('heading',{name:'Alex Morgan'})).toBeVisible();
 await expect(page.getByText('No payment QR in demo mode')).toBeVisible();
 await expect(page.getByRole('button',{name:'Save QR',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/viewer-${test.info().project.name}.png`,fullPage:true});
 await page.goBack(); await expect(page.getByText('Pick a place to send.')).toBeVisible();
 await page.getByRole('button',{name:'Directory',exact:true}).click();
 await page.getByRole('searchbox').fill('');await page.getByRole('heading').click();
 await page.screenshot({path:`test-results/directory-${test.info().project.name}.png`,fullPage:true});
 expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);
});
test('admin login is separate; keyboard, dialog and offline state work',async({page,context})=>{
 await page.goto('/?demo=1');await page.keyboard.press('Tab');await expect(page.getByText('Skip to content')).toBeFocused();
 await page.getByRole('button',{name:'Install and help'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'Admin',exact:true}).click();await expect(page.getByRole('textbox',{name:'Email',exact:true})).toBeVisible();
 await expect(page.getByLabel('Password',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Directory',exact:true}).click();await page.getByRole('searchbox').fill('missing');await expect(page.getByRole('heading',{name:'No one by that name.'})).toBeVisible();
 await context.setOffline(true);await expect(page.getByRole('heading',{name:'A connection, please.'})).toBeVisible();await expect(page.locator('.member-row')).toHaveCount(0);await context.setOffline(false);
});
test('reduced motion disables entry animation',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?demo=1');await expect(page.locator('.page-enter')).toHaveCSS('animation-name','none');
});
