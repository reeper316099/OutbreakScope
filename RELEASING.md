# Releasing OutbreakScope (exact steps)

The repository already exists at https://github.com/reeper316099/OutbreakScope. Run these yourself.

1. Make sure everything is committed and the checks pass locally:

   ```bash
   npm ci && npm run lint && npm run typecheck && npm test && npm run test:e2e
   git status
   ```

2. Commit anything outstanding and push to `main`:

   ```bash
   git add -A
   git commit -m "Prepare v0.1.0"
   git push origin main
   ```

3. Open the **Actions** tab on GitHub and wait for the **CI** workflow on `main` to go green. (It has never run yet; if it fails, read the failing step's log, fix, and push again. The most likely trouble spots are the Linux end-to-end step and the Electron sandbox helper.)

4. Check that the version in `package.json` is `0.1.0` and `CHANGELOG.md` describes it.

5. Create and push the tag (this triggers the **Release** workflow):

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

6. Watch **Actions > Release**: three build jobs (Ubuntu, Windows, macOS) and a checksum job. Each build publishes its installers to the release for the tag.

7. Open **Releases** (https://github.com/reeper316099/OutbreakScope/releases). You should see for `v0.1.0`: `OutbreakScope-Setup-0.1.0-x64.exe`, `OutbreakScope-Portable-0.1.0-x64.exe`, `OutbreakScope-0.1.0-mac-arm64.dmg`, `OutbreakScope-0.1.0-mac-x64.dmg`, `OutbreakScope-0.1.0-linux-x86_64.AppImage` (name may use `x64`), `OutbreakScope-0.1.0-linux-amd64.deb`, plus `SHA256SUMS` and the `latest*.yml` update metadata.

8. Verify a download: `shasum -a 256 <file>` (macOS/Linux) or `Get-FileHash <file>` (PowerShell) and compare with `SHA256SUMS`.

9. If the workflow fails halfway: delete the release and the tag, fix, and retry:

   ```bash
   gh release delete v0.1.0 --yes
   git push --delete origin v0.1.0
   git tag -d v0.1.0
   ```

After the first release, click through the manual checklist in the README on your own machine (launch, change a slider, add an intervention, run a stochastic ensemble, open a sample dataset and fit it, export a CSV, toggle dark mode, quit and relaunch).
