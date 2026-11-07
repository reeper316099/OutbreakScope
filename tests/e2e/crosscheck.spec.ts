import { expect, test } from '@playwright/test';
import path from 'node:path';
import { launchApp, menu, ready, setField, stubDialogs } from './helpers';

// Exports three scenarios through the real app so tools/crosscheck.py can re-solve them with SciPy. Runs only when CROSSCHECK_DIR is set.
const dir = process.env['CROSSCHECK_DIR'];

test.describe('cross-check exports', () => {
  test.skip(dir === undefined, 'set CROSSCHECK_DIR to export CSVs for tools/crosscheck.py');

  test('export three scenarios', async () => {
    const out = dir ?? '';
    const app = await launchApp();
    const page = await ready(app);
    const exportAs = async (name: string): Promise<void> => {
      await page.waitForTimeout(300); // let the debounced redraw settle
      await stubDialogs(app, { save: path.join(out, name) });
      await menu(page, 'file:export-csv');
      await expect(page.locator('#toast')).toContainText(`CSV saved as ${name}`);
    };
    // A: plain SEIR
    await setField(page, 'r0', 2.8);
    await setField(page, 'incubationDays', 4);
    await setField(page, 'infectiousDays', 6);
    await setField(page, 'horizonDays', 200);
    await exportAs('crosscheck-A-seir.csv');
    // B: SIR with a contact reduction
    await page.selectOption('#model-select', 'SIR');
    await setField(page, 'r0', 3.5);
    await setField(page, 'infectiousDays', 5);
    await setField(page, 'population', 500000);
    await setField(page, 'initialInfected', 5);
    await setField(page, 'horizonDays', 150);
    await page.locator('#btn-add-contact').click();
    await exportAs('crosscheck-B-sir-contact.csv');
    // C: SEIR + vaccination with a contact reduction
    await page.selectOption('#model-select', 'SEIRV');
    await setField(page, 'r0', 3);
    await setField(page, 'incubationDays', 3);
    await setField(page, 'infectiousDays', 5);
    await setField(page, 'population', 2000000);
    await setField(page, 'initialInfected', 20);
    await setField(page, 'vaccineEfficacy', 0.8);
    await setField(page, 'horizonDays', 250);
    await page.locator('#btn-add-vax').click();
    await exportAs('crosscheck-C-seirv.csv');
    await app.close();
  });
});
