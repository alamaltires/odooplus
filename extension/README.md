# MSRP Finder Helper

Lets the MSRP Finder page read retailer prices through *your* Chrome (so
Cloudflare-protected shops work) instead of through the server.

## Install (Chrome / Edge, once per computer)
1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and choose this `extension/` folder.
3. Open your MSRP Finder site, click the extension icon and press **Allow this site**.

Keep the folder in place — Chrome loads the extension from it.
After updating the files, press the reload icon on the extension card.

## Notes
- Only sites in the allow-list can use the extension; everything else is refused.
- If a shop shows a "Just a moment" check, open that shop once in a normal tab,
  pass the check, then run the price check again.
