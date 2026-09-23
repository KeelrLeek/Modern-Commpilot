// Native messaging host for Chrome and Firefox on Windows.
// Generic credentials are encrypted and managed by Windows Credential Manager.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
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

    private static Dictionary<string, object> Handle(Dictionary<string, object> request)
    {
        string origin = Field(request, "origin");
        Uri site;
        if (!Uri.TryCreate(origin, UriKind.Absolute, out site) || site.Scheme != "https" ||
            site.Port != 443 || site.UserInfo.Length != 0 || site.AbsolutePath != "/" ||
            !AllowedHosts.Contains(site.Host)) return Error("Site is not allowed");

        string target = "BroadWorks Enhancer/" + site.Host.ToLowerInvariant();
        string op = Field(request, "op");
        if (op == "get")
        {
            IntPtr pointer;
            if (!CredRead(target, CredTypeGeneric, 0, out pointer))
            {
                if (Marshal.GetLastWin32Error() == ErrorNotFound)
                    return new Dictionary<string, object> { { "ok", true }, { "found", false } };
                return Error("Windows Credential Manager could not read the login");
            }
            try
            {
                Credential saved = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
                string password = saved.CredentialBlobSize == 0 ? "" :
                    Marshal.PtrToStringUni(saved.CredentialBlob, (int)saved.CredentialBlobSize / 2);
                return new Dictionary<string, object>
                {
                    { "ok", true }, { "found", true },
                    { "user", saved.UserName ?? "" }, { "password", password ?? "" }
                };
            }
            finally { CredFree(pointer); }
        }

        if (op == "delete")
        {
            if (CredDelete(target, CredTypeGeneric, 0) || Marshal.GetLastWin32Error() == ErrorNotFound)
                return Result(true);
            return Error("Windows Credential Manager could not remove the login");
        }

        if (op != "save") return Error("Unknown operation");
        string user = Field(request, "user");
        string secret = Field(request, "password");
        if (user.Length == 0 || secret.Length == 0 || user.Length > 256 || secret.Length > 2048 ||
            user.IndexOf('\0') >= 0 || secret.IndexOf('\0') >= 0)
            return Error("Invalid User ID or Password");

        byte[] bytes = Encoding.Unicode.GetBytes(secret);
        IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            Credential credential = new Credential
            {
                Type = CredTypeGeneric,
                TargetName = target,
                UserName = user,
                CredentialBlobSize = (uint)bytes.Length,
                CredentialBlob = blob,
                Persist = CredPersistLocalMachine,
                Comment = "BroadWorks Enhancer automatic sign-in"
            };
            return CredWrite(ref credential, 0) ? Result(true) :
                Error("Windows Credential Manager could not save the login");
        }
        finally
        {
            Array.Clear(bytes, 0, bytes.Length);
            Marshal.Copy(new byte[bytes.Length], 0, blob, bytes.Length);
            Marshal.FreeHGlobal(blob);
        }
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
