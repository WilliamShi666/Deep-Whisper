# Third-party components

The application depends on packages recorded with exact resolutions in
pnpm-lock.yaml. Their licenses remain applicable; the project's MIT license does
not replace them. Principal components include Next.js/React (MIT), Drizzle ORM
(Apache-2.0), better-sqlite3 (MIT), SQLite (public domain), Nodemailer (MIT-0),
Tailwind CSS/shadcn/Radix components (MIT), and the AWS SDK (Apache-2.0).

The generated production dependency inventory is in
[docs/opensource/dependency-licenses.json](docs/opensource/dependency-licenses.json),
from `pnpm licenses list --prod --json` using this lockfile. Upstream copyright
and license texts are retained with installed packages; do not strip them from
redistributed dependency bundles. Update this inventory when dependencies change.
Asset distribution is governed separately by ASSETS.md.

The inventory includes sharp's optional libvips binary (LGPL-3.0-or-later) and
caniuse-lite data (CC-BY-4.0). Preserve their bundled notices and upstream source
references when redistributing binary/container dependencies. Optional native
packages vary by operating system; this inventory was generated on macOS and is
not evidence that other platform bundles have been audited.

## Character artwork and attribution

The 16 character illustrations and 40 wallpaper sets (including landscape
versions and thumbnails) derive from the 大肥鱼 / whale-girl character and use
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), separately
from MIT code. Original character: [上善无形](https://space.bilibili.com/4456176);
DeepSeek-element adaptation: [ZipZipPipe](https://space.bilibili.com/4168597).
Community reference: [Fish Archive](https://fisharchive.cc/). Project adaptations:
[WilliamShi666 / Deep Whisper](https://github.com/WilliamShi666/Deep-Whisper).
Preserve attribution, license links and modification notices when sharing;
commercial permissions require the relevant rights holders. See
[ASSETS.md](ASSETS.md) for the exact scope, source-verification boundary and
separate branding terms.
