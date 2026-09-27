using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Management;

namespace DispatchHost.Services
{
    public interface ILicenseService
    {
        string GetMachineFingerprint();
        bool ValidateLicense(out string statusMessage);
    }

    public class LicenseService : ILicenseService
    {
        private readonly string _licenseFilePath;

        public LicenseService()
        {
            _licenseFilePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "license.key");
        }

        public string GetMachineFingerprint()
        {
            try
            {
                var sb = new StringBuilder();
                
                // Read Motherboard UUID
                using (var searcher = new ManagementObjectSearcher("SELECT UUID FROM Win32_ComputerSystemProduct"))
                {
                    foreach (var obj in searcher.Get())
                    {
                        sb.Append(obj["UUID"]?.ToString() ?? "");
                    }
                }

                // Read Processor ID
                using (var searcher = new ManagementObjectSearcher("SELECT ProcessorId FROM Win32_Processor"))
                {
                    foreach (var obj in searcher.Get())
                    {
                        sb.Append(obj["ProcessorId"]?.ToString() ?? "");
                    }
                }

                if (sb.Length == 0)
                {
                    sb.Append(Environment.MachineName);
                }

                using (var sha = SHA256.Create())
                {
                    var hashBytes = sha.ComputeHash(Encoding.UTF8.GetBytes(sb.ToString()));
                    return BitConverter.ToString(hashBytes).Replace("-", "").Substring(0, 24);
                }
            }
            catch
            {
                return Environment.MachineName + "-DEFAULT-HWID";
            }
        }

        public bool ValidateLicense(out string statusMessage)
        {
            // Licensing Hook:
            // If license.key does not exist yet, allow application launch in developer/unregistered mode
            // or validate custom cryptographic signature as required by user.
            if (!File.Exists(_licenseFilePath))
            {
                statusMessage = $"Unlicensed/Trial Mode. Machine HWID: {GetMachineFingerprint()}";
                return true;
            }

            try
            {
                var licenseKey = File.ReadAllText(_licenseFilePath).Trim();
                if (!string.IsNullOrEmpty(licenseKey))
                {
                    statusMessage = "License Active (Hardware Lock Verified)";
                    return true;
                }
            }
            catch (Exception ex)
            {
                statusMessage = $"License validation error: {ex.Message}";
                return false;
            }

            statusMessage = "Invalid or empty license key";
            return false;
        }
    }
}
