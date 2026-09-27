using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace DispatchHost
{
    static class Program
    {
        // ─── Windows Kernel Job Object P/Invoke ──────────────────────────────────
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll")]
        static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool CloseHandle(IntPtr hObject);

        const int JobObjectExtendedLimitInformation = 9;
        const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

        [StructLayout(LayoutKind.Sequential)]
        struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryLimit;
            public UIntPtr PeakJobMemoryLimit;
        }

        static IntPtr hJob = IntPtr.Zero;

        static void InitJobObject()
        {
            try
            {
                hJob = CreateJobObject(IntPtr.Zero, null);
                var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                IntPtr pInfo = Marshal.AllocHGlobal(length);
                try
                {
                    Marshal.StructureToPtr(info, pInfo, false);
                    SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, pInfo, (uint)length);
                }
                finally
                {
                    Marshal.FreeHGlobal(pInfo);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("Could not init job object: " + ex.Message);
            }
        }

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            InitJobObject();

            string appDir = AppDomain.CurrentDomain.BaseDirectory;

            // Locate node.exe (embedded first, then system)
            string nodePath = Path.Combine(appDir, "node.exe");
            if (!File.Exists(nodePath))
            {
                nodePath = "node.exe";
            }

            // Locate script (server.js in release or src/server.js in dev)
            string scriptPath = Path.Combine(appDir, "server.js");
            if (!File.Exists(scriptPath))
            {
                scriptPath = Path.Combine(appDir, "src", "server.js");
            }
            if (!File.Exists(scriptPath))
            {
                // Traverse up
                var parent = Directory.GetParent(appDir);
                if (parent != null && File.Exists(Path.Combine(parent.FullName, "src", "server.js")))
                {
                    scriptPath = Path.Combine(parent.FullName, "src", "server.js");
                    appDir = parent.FullName;
                }
            }

            // Verify license.key presence before launching anything
            string licensePath = Path.Combine(appDir, "license.key");
            if (!File.Exists(licensePath))
            {
                var parent = Directory.GetParent(appDir);
                if (parent != null && File.Exists(Path.Combine(parent.FullName, "license.key")))
                {
                    licensePath = Path.Combine(parent.FullName, "license.key");
                }
            }
            if (!File.Exists(licensePath))
            {
                string fingerprint = GetMachineFingerprint(nodePath, appDir);
                ShowLicenseDialog(fingerprint, appDir);
                return;
            }

            // Generate secret token for authorized kiosk window
            string authToken = Guid.NewGuid().ToString("N");

            // Start silent backend process
            Process nodeProc = null;
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = nodePath,
                    Arguments = "\"" + scriptPath + "\" --app-token=" + authToken,
                    WorkingDirectory = appDir,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                psi.EnvironmentVariables["APP_TOKEN"] = authToken;

                nodeProc = Process.Start(psi);
                if (nodeProc != null && hJob != IntPtr.Zero)
                {
                    // Bind to kernel job object: Windows OS will automatically kill node when this host closes!
                    AssignProcessToJobObject(hJob, nodeProc.Handle);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to launch background engine:\n" + ex.Message, "RK FG Dispatch Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            // Wait for server to become ready (localhost:4000)
            bool ready = WaitForServer(nodeProc, "http://localhost:4000/api/system/health?authToken=" + authToken, 15000);
            if (!ready)
            {
                if (nodeProc != null && nodeProc.HasExited)
                {
                    MessageBox.Show("Background server engine exited unexpectedly on startup (Exit code: " + nodeProc.ExitCode + ").\nPlease ensure license.key is valid, port 4000 is available, and MongoDB is accessible.", "Startup Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                else
                {
                    MessageBox.Show("Background server did not respond in time.", "Timeout Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                if (nodeProc != null && !nodeProc.HasExited)
                {
                    try { nodeProc.Kill(); } catch { }
                }
                return;
            }

            // Launch Microsoft Edge or Chrome in App Mode (Dedicated single-app kiosk window, no address bar, no browser tabs)
            LaunchAppWindow("http://localhost:4000/auth-launch?token=" + authToken);

            // When app window closes, ensure cleanup
            if (nodeProc != null && !nodeProc.HasExited)
            {
                try { nodeProc.Kill(); } catch { }
            }
            if (hJob != IntPtr.Zero)
            {
                CloseHandle(hJob);
            }
        }

        static bool WaitForServer(Process nodeProc, string url, int timeoutMs)
        {
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < timeoutMs)
            {
                if (nodeProc != null && nodeProc.HasExited)
                {
                    return false;
                }
                try
                {
                    var req = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(url);
                    req.Proxy = null; // Bypass system WPAD proxy auto-detection delays
                    req.Timeout = 1000;
                    using (var resp = req.GetResponse())
                    {
                        return true;
                    }
                }
                catch (System.Net.WebException wex)
                {
                    if (wex.Response != null) return true; // Server replied (e.g. 401)
                    Thread.Sleep(300);
                }
                catch
                {
                    Thread.Sleep(300);
                }
            }
            return false;
        }

        static void LaunchAppWindow(string url)
        {
            // Find Chrome or Edge executable (Chrome handles offline app windows & favicons natively)
            string browserPath = null;
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] candidates = new string[] {
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                Path.Combine(localAppData, @"Google\Chrome\Application\chrome.exe"),
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
            };

            foreach (var c in candidates)
            {
                if (File.Exists(c)) { browserPath = c; break; }
            }

            if (browserPath != null)
            {
                // Isolate user data dir so Chromium creates a standalone dedicated window and process
                string dataDir = Path.Combine(Path.GetTempPath(), "rk_dispatch_edge_profile");
                var psi = new ProcessStartInfo
                {
                    FileName = browserPath,
                    Arguments = string.Format("--app=\"{0}\" --user-data-dir=\"{1}\" --window-size=1366,820 --disable-pinch --no-first-run --no-default-browser-check", url, dataDir),
                    UseShellExecute = false
                };
                var browserProc = Process.Start(psi);
                if (browserProc != null)
                {
                    browserProc.WaitForExit();
                }
            }
            else
            {
                // Fallback to default browser
                Process.Start(url);
            }
        }

        static string GetMachineFingerprint(string nodePath, string appDir)
        {
            try
            {
                string script = "const crypto=require('crypto'),os=require('os'),{execSync}=require('child_process');let r='';try{r+=execSync('wmic baseboard get serialnumber /format:list',{stdio:['pipe','pipe','ignore'],timeout:2000}).toString().replace(/SerialNumber=/gi,'').trim()}catch(e){}try{r+=execSync('wmic cpu get processorid /format:list',{stdio:['pipe','pipe','ignore'],timeout:2000}).toString().replace(/ProcessorId=/gi,'').trim()}catch(e){}const n=os.networkInterfaces();for(const k of Object.keys(n)){for(const x of n[k]){if(!x.internal&&x.mac&&x.mac!=='00:00:00:00:00:00'){r+=x.mac;break}}}if(!r)r=os.hostname();const h=crypto.createHash('sha256').update(r).digest('hex').toUpperCase();process.stdout.write('RKFG-'+h.substring(0,4)+'-'+h.substring(4,8)+'-'+h.substring(8,12)+'-'+h.substring(12,16))";
                var psi = new ProcessStartInfo
                {
                    FileName = nodePath,
                    Arguments = "-e \"" + script + "\"",
                    WorkingDirectory = appDir,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardOutput = true
                };
                using (var p = Process.Start(psi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(3000);
                    if (!string.IsNullOrEmpty(output) && output.StartsWith("RKFG-"))
                    {
                        return output.Trim();
                    }
                }
            }
            catch { }
            return "RKFG-NODE-" + Environment.MachineName.ToUpper();
        }

        static void ShowLicenseDialog(string machineFingerprint, string appDir)
        {
            using (var form = new Form())
            {
                form.Text = "RK FG Dispatch - License Activation";
                form.Size = new System.Drawing.Size(530, 340);
                form.StartPosition = FormStartPosition.CenterScreen;
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.MaximizeBox = false;
                form.MinimizeBox = false;
                form.BackColor = System.Drawing.Color.FromArgb(248, 250, 252);
                form.Font = new System.Drawing.Font("Segoe UI", 9.5f);

                var lblTitle = new Label
                {
                    Text = "LICENSE ACTIVATION REQUIRED",
                    Font = new System.Drawing.Font("Segoe UI", 12f, System.Drawing.FontStyle.Bold),
                    ForeColor = System.Drawing.Color.FromArgb(220, 38, 38),
                    Location = new System.Drawing.Point(24, 18),
                    AutoSize = true
                };

                var lblMsg = new Label
                {
                    Text = "No valid 'license.key' was found. To activate RK FG Dispatch System,\nsend the Machine Fingerprint below to the vendor to generate your key.",
                    ForeColor = System.Drawing.Color.FromArgb(51, 65, 85),
                    Location = new System.Drawing.Point(24, 50),
                    Size = new System.Drawing.Size(465, 42)
                };

                var lblFp = new Label
                {
                    Text = "Machine Fingerprint (Hardware ID):",
                    Font = new System.Drawing.Font("Segoe UI", 9f, System.Drawing.FontStyle.Bold),
                    ForeColor = System.Drawing.Color.FromArgb(15, 23, 42),
                    Location = new System.Drawing.Point(24, 102),
                    AutoSize = true
                };

                var txtFp = new TextBox
                {
                    Text = machineFingerprint,
                    ReadOnly = true,
                    Font = new System.Drawing.Font("Consolas", 12f, System.Drawing.FontStyle.Bold),
                    ForeColor = System.Drawing.Color.FromArgb(2, 132, 199),
                    BackColor = System.Drawing.Color.FromArgb(241, 245, 249),
                    Location = new System.Drawing.Point(24, 126),
                    Size = new System.Drawing.Size(325, 28)
                };

                var btnCopy = new Button
                {
                    Text = "Copy ID",
                    Font = new System.Drawing.Font("Segoe UI", 9f, System.Drawing.FontStyle.Bold),
                    BackColor = System.Drawing.Color.FromArgb(14, 165, 233),
                    ForeColor = System.Drawing.Color.White,
                    FlatStyle = FlatStyle.Flat,
                    Location = new System.Drawing.Point(360, 125),
                    Size = new System.Drawing.Size(125, 30),
                    Cursor = Cursors.Hand
                };
                btnCopy.FlatAppearance.BorderSize = 0;
                btnCopy.Click += (s, e) =>
                {
                    Clipboard.SetText(machineFingerprint);
                    btnCopy.Text = "Copied! \u2713";
                    btnCopy.BackColor = System.Drawing.Color.FromArgb(22, 163, 74);
                };

                var lblPath = new Label
                {
                    Text = "Target folder for license.key:\n" + appDir,
                    Font = new System.Drawing.Font("Segoe UI", 8.5f),
                    ForeColor = System.Drawing.Color.FromArgb(100, 116, 139),
                    Location = new System.Drawing.Point(24, 172),
                    Size = new System.Drawing.Size(465, 36)
                };

                var btnFolder = new Button
                {
                    Text = "Open Folder",
                    Location = new System.Drawing.Point(24, 230),
                    Size = new System.Drawing.Size(120, 32),
                    Cursor = Cursors.Hand
                };
                btnFolder.Click += (s, e) =>
                {
                    try { Process.Start("explorer.exe", appDir); } catch { }
                };

                var btnExit = new Button
                {
                    Text = "Close",
                    Location = new System.Drawing.Point(365, 230),
                    Size = new System.Drawing.Size(120, 32),
                    Cursor = Cursors.Hand
                };
                btnExit.Click += (s, e) => { form.Close(); };

                form.Controls.AddRange(new Control[] { lblTitle, lblMsg, lblFp, txtFp, btnCopy, lblPath, btnFolder, btnExit });
                form.ShowDialog();
            }
        }
    }
}
