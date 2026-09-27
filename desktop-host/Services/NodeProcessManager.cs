using System;
using System.Diagnostics;
using System.IO;

namespace DispatchHost.Services
{
    public class NodeProcessManager : IDisposable
    {
        private Process? _nodeProcess;
        public int Port { get; private set; } = 4000;
        public bool IsRunning => _nodeProcess != null && !_nodeProcess.HasExited;

        public void Start(string rootDir)
        {
            if (IsRunning) return;

            string scriptPath = Path.Combine(rootDir, "src", "server.js");
            if (!File.Exists(scriptPath))
            {
                scriptPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "src", "server.js");
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = "node.exe",
                Arguments = $"\"{scriptPath}\"",
                WorkingDirectory = rootDir,
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };

            try
            {
                _nodeProcess = new Process { StartInfo = startInfo };
                _nodeProcess.OutputDataReceived += (s, e) =>
                {
                    if (!string.IsNullOrEmpty(e.Data))
                    {
                        Debug.WriteLine($"[NODE STDOUT] {e.Data}");
                    }
                };
                _nodeProcess.ErrorDataReceived += (s, e) =>
                {
                    if (!string.IsNullOrEmpty(e.Data))
                    {
                        Debug.WriteLine($"[NODE STDERR] {e.Data}");
                    }
                };

                _nodeProcess.Start();
                _nodeProcess.BeginOutputReadLine();
                _nodeProcess.BeginErrorReadLine();
                Debug.WriteLine($"[NODE MANAGER] Started silent node process ID: {_nodeProcess.Id}");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[NODE MANAGER ERROR] Failed to start node: {ex.Message}");
            }
        }

        public void Stop()
        {
            if (_nodeProcess != null && !_nodeProcess.HasExited)
            {
                try
                {
                    Debug.WriteLine($"[NODE MANAGER] Stopping node process ID: {_nodeProcess.Id}");
                    _nodeProcess.Kill(entireProcessTree: true);
                    _nodeProcess.WaitForExit(3000);
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[NODE MANAGER] Error killing process: {ex.Message}");
                }
                finally
                {
                    _nodeProcess.Dispose();
                    _nodeProcess = null;
                }
            }
        }

        public void Dispose()
        {
            Stop();
        }
    }
}
