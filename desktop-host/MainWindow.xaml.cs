using System;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows;
using DispatchHost.Services;

namespace DispatchHost
{
    public partial class MainWindow : Window
    {
        private readonly NodeProcessManager _nodeManager;
        private readonly ILicenseService _licenseService;

        public MainWindow()
        {
            InitializeComponent();

            _nodeManager = new NodeProcessManager();
            _licenseService = new LicenseService();

            Loaded += MainWindow_Loaded;
        }

        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            // 1. Validate License Hook
            if (!_licenseService.ValidateLicense(out string licenseStatus))
            {
                MessageBox.Show($"Application License Error:\n{licenseStatus}", "License Required", MessageBoxButton.OK, MessageBoxImage.Warning);
                Close();
                return;
            }

            txtStatus.Text = $"{licenseStatus} | Launching background daemon...";

            // 2. Locate project root & start silent Node process
            string projectRoot = FindProjectRoot();
            _nodeManager.Start(projectRoot);

            // 3. Wait for Node.js server to become ready
            txtStatus.Text = "Connecting to Dispatch engine (localhost:4000)...";
            bool serverReady = await WaitForServerAsync("http://localhost:4000/api/system/status", 15000);

            // 4. Initialize WebView2
            try
            {
                await webView.EnsureCoreWebView2Async(null);
                
                // Disable browser context menus or status bars for pure app feel
                webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                webView.CoreWebView2.Settings.IsStatusBarEnabled = false;

                webView.Source = new Uri("http://localhost:4000");

                // Hide loader
                await Task.Delay(500);
                splashLoader.Visibility = Visibility.Collapsed;
            }
            catch (Exception ex)
            {
                MessageBox.Show($"WebView2 Error: {ex.Message}", "Initialization Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async Task<bool> WaitForServerAsync(string testUrl, int timeoutMs)
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(1000) };
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();

            while (stopwatch.ElapsedMilliseconds < timeoutMs)
            {
                try
                {
                    var res = await client.GetAsync(testUrl);
                    if (res.IsSuccessStatusCode || (int)res.StatusCode == 401)
                    {
                        return true;
                    }
                }
                catch
                {
                    await Task.Delay(500);
                }
            }
            return false;
        }

        private string FindProjectRoot()
        {
            string current = AppDomain.CurrentDomain.BaseDirectory;
            for (int i = 0; i < 4; i++)
            {
                if (File.Exists(Path.Combine(current, "src", "server.js")))
                {
                    return current;
                }
                var parent = Directory.GetParent(current);
                if (parent == null) break;
                current = parent.FullName;
            }
            return AppDomain.CurrentDomain.BaseDirectory;
        }

        private void Window_Closing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            // Terminate background node process tree cleanly on exit
            _nodeManager.Stop();
        }
    }
}
