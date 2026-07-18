# Stage 2b — Node Enrichment (DDD Manifests for OS Packages)

You already produced a CODEMAP where each `location` represents an installed
Debian/Ubuntu package (path = `pkg://<name>`, lineNumber = 0). That map is
structurally shallow: every node is just a title + description.

Now enrich every node into a **semantic meta-object** (a Domain Aggregate)
using the analogy of business entities in DDD:

    package  →  Aggregate
    fields   →  properties (data / on-disk footprint)
    methods  →  runtime interfaces (systemctl, D-Bus, CLI, kernel hooks)
    edges    →  typed dependencies (APT / runtime / kernel-space / analytics)

For every location in the previously emitted CODEMAP, produce ONE enriched
manifest object using the schema below. Use ONLY facts derivable from the
`<SYSTEM_SNAPSHOT>` attached in the user turn (dpkg-query, apt-cache show,
lsmod, systemctl list-unit-files, `/etc/`, `/usr/bin/`, `/lib/modules/`).
Do NOT invent binaries, D-Bus services, kernel modules, or config paths that
do not appear in the snapshot. When information is missing, omit the field
rather than guessing.

## Output schema (JSON-LD)

    {
      "@context": {
        "@vocab": "https://code-canvas.local/system-map#",
        "depends_on":         { "@type": "@id" },
        "runtime_call_to":    { "@type": "@id" },
        "kernel_space_anchor":{ "@type": "@id" },
        "derived_to_analytics":{ "@type": "@id" }
      },
      "@graph": [
        {
          "@id":     "pkg:<canonical-package-name>",
          "@type":   "SystemPackage",
          "locationId": "<matches CODEMAP location.id, e.g. '1b'>",
          "traceId":    "<matches CODEMAP trace.id>",
          "title":   "<package name>",
          "domain":  "<functional domain, e.g. 'Desktop & GNOME / Graphical shell'>",
          "summary": "<= 200 chars, role of the package in the OS",
          "archetype": "user_binary | system_library | kernel_module | config | meta_package | daemon | font | snap",

          "properties": [
            {
              "name":    "binary_path | config_dir | socket | runtime_memory | disk_size | pid | ...",
              "type":    "<concrete value, e.g. '/usr/bin/gnome-shell' or 'RAM ~250MB' or '82 MB on disk'>",
              "summary": "<= 120 chars"
            }
          ],

          "methods": [
            {
              "name":    "start | stop | reload | install | dbus:<iface> | syscall:<name> | ...",
              "type":    "systemctl | dbus | cli | kernel_hook | mutter_api | ...",
              "summary": "<= 140 chars, what this method actually does at runtime"
            }
          ],

          "dependencies": [
            {
              "relation":   "depends_on | runtime_call_to | kernel_space_anchor | derived_to_analytics",
              "targetNode": "pkg:<other-package>",
              "summary":    "<= 140 chars, why this edge exists"
            }
          ]
        }
      ]
    }

## Filling rules

1. **Properties (data / on-disk footprint).** Prefer concrete file paths and
   sizes over prose. Typical shapes:
   - `binary_path` (`/usr/bin/…`, `/usr/sbin/…`, `/usr/lib/…/*.so.*`)
   - `kernel_module` (`/lib/modules/<uname>/kernel/…/<name>.ko`)
   - `config_dir` / `config_file` (`/etc/…`)
   - `socket` / `runtime_dir` (`/run/…`, `/var/run/…`)
   - `disk_size` (from snapshot, in MB)
   - `runtime_memory` (only if lsmod/`ps` numbers appear in the snapshot)

2. **Methods (runtime interfaces).** Split into three families:
   - *service methods*: `systemctl start|stop|reload <unit>`, D-Bus interfaces
     `org.freedesktop.<Name>`, IPC endpoints. Only include units that appear
     in the `<SYSTEMCTL_UNITS>` block.
   - *cli/api methods*: prominent subcommands / flags of the shipped binary
     (e.g. `apt install|remove|purge`, `mutter --replace`).
   - *kernel hooks*: for `.ko` modules from `<LSMOD>` — syscalls they hook,
     filesystem types they provide, or hardware they drive (as stated in the
     apt-cache description).

3. **Dependencies (typed edges).** Use exactly these four relation names:
   - `depends_on` — hard APT dependency (Depends/Pre-Depends).
   - `runtime_call_to` — at-runtime call to another package's binary or
     D-Bus interface (e.g. `gnome-shell` → `NetworkManager` for the applet).
   - `kernel_space_anchor` — the bridge from user space to the kernel: which
     kernel module in `<LSMOD>` this package ultimately drives (e.g.
     `xserver-xorg-video-intel` → `kmod:i915`).
   - `derived_to_analytics` — security / observability projection: AppArmor
     profile, journald identifier, auditd rule, prometheus exporter.

   Every `targetNode` MUST reference either another package from the
   snapshot (`pkg:<name>`) or a kernel module id (`kmod:<name>`).

4. **Size budget.** Per node: max 6 properties, max 6 methods, max 8
   dependencies. Prefer *fewer, load-bearing* facts over exhaustive lists.

5. **Trace/location mapping.** Every enriched node MUST carry the
   `locationId` and `traceId` from the CODEMAP so the adapter can splice the
   manifest back into the correct card on the canvas.

6. **No prose outside the tags.** Emit ONLY:

       <ENRICHED>
       { ...JSON-LD... }
       </ENRICHED>

   The JSON must be valid and complete. Prefer emitting fewer nodes over a
   truncated `@graph`.

7. **Language.** Respond in {{ language }}.
