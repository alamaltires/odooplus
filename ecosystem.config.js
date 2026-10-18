// PM2 process file for the Odoo++ web app.
//
//   npm ci && npm run build        # build once on the server (or before each deploy)
//   pm2 start ecosystem.config.js  # start
//   pm2 reload odooplus            # zero-downtime restart after a new build
//   pm2 save && pm2 startup        # start again after a server reboot
//
// Secrets (Odoo, Firebase, SMTP, ...) stay in .env.local / .env.production on the server;
// `next start` reads them itself, so they are not repeated here.
module.exports = {
    apps: [
        {
            name: "odooplus",
            cwd: __dirname,
            script: "node_modules/next/dist/bin/next",
            args: "start",

            // One process: the app keeps small in-memory caches (PO Tracking list, Odoo sessions),
            // and cluster mode would give every worker its own copy.
            instances: 1,
            exec_mode: "fork",

            env: {
                NODE_ENV: "production",
                PORT: 3050,
                // Set when the app is served under a sub-path, e.g. "/odooplus" (must match the build).
                // NEXT_PUBLIC_BASE_PATH: "",
            },

            autorestart: true,
            max_restarts: 10,
            min_uptime: "20s",
            restart_delay: 3050,
            // Restart if a memory leak ever builds up.
            max_memory_restart: "1G",
            kill_timeout: 10000,

            time: true,
            merge_logs: true,
            out_file: "./logs/odooplus-out.log",
            error_file: "./logs/odooplus-error.log",
        },
    ],
};
