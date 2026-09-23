// Native messaging host for Chrome and Firefox on Windows.
// Generic credentials are encrypted and managed by Windows Credential Manager.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal static class BroadWorksCredentialHost
{
    private const uint CredTypeGeneric = 1;
    private const uint CredPersistLocalMachine = 2;
    private const int ErrorNotFound = 1168;
    private const int MaxMessageBytes = 65536;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly HashSet<string> AllowedHosts = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "apps.avpaas.io", "apps01.avpaas.io", "apps02.avpaas.io",
        "apps-sbx.avpaas.io", "phone.tripbx.com", "phone1.tripbx.com",
        "phone2.tripbx.com"
    };

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags;
        public uint Type;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
        [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
        [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref Credential credential, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredEnumerateW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredEnumerate(string filter, uint flags, out uint count, out IntPtr credentials);

    [DllImport("advapi32.dll", EntryPoint = "CredFree")]
    private static extern void CredFree(IntPtr credential);

    private static void ReadExactly(Stream stream, byte[] buffer)
    {
        int offset = 0;
        while (offset < buffer.Length)
        {
            int count = stream.Read(buffer, offset, buffer.Length - offset);
            if (count <= 0) throw new EndOfStreamException();
            offset += count;
        }
    }

    private static string Field(Dictionary<string, object> request, string key)
    {
        object value;
        return request.TryGetValue(key, out value) && value is string ? (string)value : "";
    }

    private static Dictionary<string, object> Result(bool ok)
    {
        return new Dictionary<string, object> { { "ok", ok } };
    }

    private static Dictionary<string, object> Error(string message)
    {
        return new Dictionary<string, object> { { "ok", false }, { "error", message } };
    }

    private static string Blob(Credential credential)
    {
        return credential.CredentialBlobSize == 0 ? "" :
            Marshal.PtrToStringUni(credential.CredentialBlob, (int)credential.CredentialBlobSize / 2);
    }

    private static string Prefix(string host)
    {
        return "BroadWorks Enhancer/v2/" + host.ToLowerInvariant() + "/";
    }

    private static bool ValidId(string id)
    {
        return Regex.IsMatch(id, "^[0-9a-f]{32}$", RegexOptions.CultureInvariant);
    }

    private static byte[] PinHash(string pin, byte[] salt)
    {
        using (var derive = new Rfc2898DeriveBytes(pin, salt, 210000))
            return derive.GetBytes(32);
    }

    private static bool PinMatches(string pin, string salt64, string hash64)
    {
        try
        {
            byte[] expected = Convert.FromBase64String(hash64);
            byte[] actual = PinHash(pin, Convert.FromBase64String(salt64));
            if (expected.Length != actual.Length) return false;
            int difference = 0;
            for (int i = 0; i < expected.Length; i++) difference |= expected[i] ^ actual[i];
            return difference == 0;
        }
        catch (Exception) { return false; }
    }

    private static Dictionary<string, object> Record(Credential credential)
    {
        try { return Json.Deserialize<Dictionary<string, object>>(Blob(credential)); }
        catch (Exception) { return null; }
    }

    private static Dictionary<string, object> ListProfiles(string host, string legacyTarget)
    {
        var profiles = new List<Dictionary<string, object>>();
        string prefix = Prefix(host);
        uint count;
        IntPtr pointers;
        if (CredEnumerate(prefix + "*", 0, out count, out pointers))
        {
            try
            {
                for (int i = 0; i < count; i++)
                {
                    IntPtr item = Marshal.ReadIntPtr(pointers, i * IntPtr.Size);
                    Credential credential = (Credential)Marshal.PtrToStructure(item, typeof(Credential));
                    if (credential.Type != CredTypeGeneric || credential.TargetName == null ||
                        !credential.TargetName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
                    string id = credential.TargetName.Substring(prefix.Length);
                    if (!ValidId(id)) continue;
                    var record = Record(credential);
                    profiles.Add(new Dictionary<string, object>
                    {
                        { "id", id }, { "user", credential.UserName ?? "" },
                        { "hasPin", record != null && Field(record, "pinHash").Length > 0 }
                    });
                }
            }
            finally { CredFree(pointers); }
        }
        else if (Marshal.GetLastWin32Error() != ErrorNotFound)
        {
            return Error("Windows Credential Manager could not list saved logins");
        }

        IntPtr oldPointer;
        if (CredRead(legacyTarget, CredTypeGeneric, 0, out oldPointer))
        {
            try
            {
                Credential old = (Credential)Marshal.PtrToStructure(oldPointer, typeof(Credential));
                profiles.Add(new Dictionary<string, object>
                {
                    { "id", "legacy" }, { "user", old.UserName ?? "" }, { "hasPin", false }
                });
            }
            finally { CredFree(oldPointer); }
        }
        profiles.Sort((a, b) => String.Compare(Field(a, "user"), Field(b, "user"), StringComparison.OrdinalIgnoreCase));
        return new Dictionary<string, object> { { "ok", true }, { "profiles", profiles } };
    }

    private static Dictionary<string, object> AddProfile(string host, Dictionary<string, object> request)
    {
        string user = Field(request, "user");
        string secret = Field(request, "password");
        string pin = Field(request, "pin");
        if (user.Length == 0 || user.Length > 256 || secret.Length == 0 || secret.Length > 512 ||
            user.IndexOf('\0') >= 0 || secret.IndexOf('\0') >= 0 ||
            (pin.Length > 0 && !Regex.IsMatch(pin, "^[0-9]{4,8}$")))
            return Error("Enter a valid User ID, Password, and optional 4–8 digit PIN");

        var record = new Dictionary<string, object> { { "password", secret } };
        if (pin.Length > 0)
        {
            byte[] salt = new byte[16];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(salt);
            record.Add("pinSalt", Convert.ToBase64String(salt));
            record.Add("pinHash", Convert.ToBase64String(PinHash(pin, salt)));
        }
        byte[] bytes = Encoding.Unicode.GetBytes(Json.Serialize(record));
        if (bytes.Length > 2500) return Error("Password is too long to save");
        IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
        string id = Guid.NewGuid().ToString("N");
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            Credential credential = new Credential
            {
                Type = CredTypeGeneric, TargetName = Prefix(host) + id,
                UserName = user, CredentialBlobSize = (uint)bytes.Length,
                CredentialBlob = blob, Persist = CredPersistLocalMachine,
                Comment = "BroadWorks Enhancer saved sign-in"
            };
            return CredWrite(ref credential, 0) ?
                new Dictionary<string, object> { { "ok", true }, { "id", id } } :
                Error("Windows Credential Manager could not save the login");
        }
        finally
        {
            Array.Clear(bytes, 0, bytes.Length);
            Marshal.Copy(new byte[bytes.Length], 0, blob, bytes.Length);
            Marshal.FreeHGlobal(blob);
        }
    }

    private static Dictionary<string, object> UnlockProfile(string host, string legacyTarget,
        Dictionary<string, object> request)
    {
        string id = Field(request, "id");
        if (id != "legacy" && !ValidId(id)) return Error("Saved login not found");
        string target = id == "legacy" ? legacyTarget : Prefix(host) + id;
        IntPtr pointer;
        if (!CredRead(target, CredTypeGeneric, 0, out pointer)) return Error("Saved login not found");
        try
        {
            Credential credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
            string secret;
            if (id == "legacy") secret = Blob(credential);
            else
            {
                var record = Record(credential);
                if (record == null) return Error("Saved login is unreadable");
                string hash = Field(record, "pinHash");
                if (hash.Length > 0 && !PinMatches(Field(request, "pin"), Field(record, "pinSalt"), hash))
                    return Error("Incorrect PIN");
                secret = Field(record, "password");
            }
            return new Dictionary<string, object>
            {
                { "ok", true }, { "user", credential.UserName ?? "" }, { "password", secret }
            };
        }
        finally { CredFree(pointer); }
    }

    private static Dictionary<string, object> RemoveProfile(string host, string legacyTarget, string id)
    {
        if (id != "legacy" && !ValidId(id)) return Error("Saved login not found");
        string target = id == "legacy" ? legacyTarget : Prefix(host) + id;
        if (CredDelete(target, CredTypeGeneric, 0) || Marshal.GetLastWin32Error() == ErrorNotFound)
            return Result(true);
        return Error("Windows Credential Manager could not remove the login");
    }

    private static Dictionary<string, object> Handle(Dictionary<string, object> request)
    {
        string origin = Field(request, "origin");
        Uri site;
        if (!Uri.TryCreate(origin, UriKind.Absolute, out site) || site.Scheme != "https" ||
            site.Port != 443 || site.UserInfo.Length != 0 || site.AbsolutePath != "/" ||
            !AllowedHosts.Contains(site.Host)) return Error("Site is not allowed");

        string target = "BroadWorks Enhancer/" + site.Host.ToLowerInvariant();
        string op = Field(request, "op");
        if (op == "list") return ListProfiles(site.Host, target);
        if (op == "add") return AddProfile(site.Host, request);
        if (op == "unlock") return UnlockProfile(site.Host, target, request);
        if (op == "remove") return RemoveProfile(site.Host, target, Field(request, "id"));
        return Error("Unknown operation");
    }

    public static void Main()
    {
        Dictionary<string, object> result;
        try
        {
            Stream input = Console.OpenStandardInput();
            byte[] sizeBytes = new byte[4];
            ReadExactly(input, sizeBytes);
            int length = BitConverter.ToInt32(sizeBytes, 0);
            if (length < 2 || length > MaxMessageBytes) throw new InvalidDataException();
            byte[] payload = new byte[length];
            ReadExactly(input, payload);
            var request = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(payload));
            result = request == null ? Error("Invalid request") : Handle(request);
        }
        catch (Exception)
        {
            result = Error("Credential helper could not process the request");
        }
        byte[] response = Encoding.UTF8.GetBytes(Json.Serialize(result));
        Stream output = Console.OpenStandardOutput();
        byte[] responseSize = BitConverter.GetBytes(response.Length);
        output.Write(responseSize, 0, responseSize.Length);
        output.Write(response, 0, response.Length);
        output.Flush();
    }
}
