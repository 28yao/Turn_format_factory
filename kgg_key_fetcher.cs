using System;
using System.Runtime.InteropServices;
using System.IO;
using System.Text;
using System.Collections.Generic;

class KggKeyFetcher {
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern bool SetDllDirectory(string lpPathName);

    [DllImport("infra.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int sqlite3_open_v2(string filename, out IntPtr ppDb, int flags, IntPtr zVfs);

    [DllImport("infra.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int sqlite3_key(IntPtr db, byte[] pKey, int nKey);

    [DllImport("infra.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int sqlite3_exec(IntPtr db, string sql, IntPtr callback, IntPtr arg, out IntPtr errmsg);

    [DllImport("infra.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr sqlite3_errmsg(IntPtr db);

    [DllImport("infra.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int sqlite3_close(IntPtr db);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate int sqlite3_callback(IntPtr pArg, int nCols, IntPtr colValues, IntPtr colNames);

    static List<Dictionary<string, string>> _results = new List<Dictionary<string, string>>();

    public static int Callback(IntPtr pArg, int nCols, IntPtr colValues, IntPtr colNames) {
        var row = new Dictionary<string, string>();
        for (int i = 0; i < nCols; i++) {
            IntPtr valPtr = Marshal.ReadIntPtr(colValues, i * IntPtr.Size);
            IntPtr namePtr = Marshal.ReadIntPtr(colNames, i * IntPtr.Size);
            string name = Marshal.PtrToStringAnsi(namePtr) ?? "col" + i;
            string val = valPtr != IntPtr.Zero ? Marshal.PtrToStringAnsi(valPtr) ?? "" : "";
            row[name] = val;
        }
        _results.Add(row);
        return 0;
    }

    static string JsonEscape(string s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder();
        sb.Append('"');
        foreach (char c in s) {
            switch (c) {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.AppendFormat("\\u{0:X4}", (int)c);
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
        return sb.ToString();
    }

    public static void Main(string[] args) {
        // Usage: KggKeyFetcher.exe <originalHash> [infraDir]
        if (args.Length < 1) {
            Console.Error.WriteLine("Usage: KggKeyFetcher.exe <originalHash> [infraDir]");
            return;
        }

        string originalHash = args[0].Trim().ToLowerInvariant();
        if (originalHash.Length != 32) {
            Console.Error.WriteLine("Error: originalHash must be 32 hex chars, got: " + originalHash.Length);
            return;
        }

        // 设置 infra.dll 的搜索目录
        if (args.Length >= 2 && !string.IsNullOrEmpty(args[1])) {
            string infraDir = args[1];
            if (Directory.Exists(infraDir)) {
                SetDllDirectory(infraDir);
            } else {
                Console.Error.WriteLine("Warning: infra directory not found: " + infraDir);
            }
        }

        string dbPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Kugou8", "KGMusicV3.db"
        );

        if (!File.Exists(dbPath)) {
            Console.Error.WriteLine("Error: DB not found: " + dbPath);
            return;
        }

        IntPtr db;
        int rc = sqlite3_open_v2(dbPath, out db, 1, IntPtr.Zero);
        if (rc != 0 || db == IntPtr.Zero) {
            Console.Error.WriteLine("Error: sqlite3_open_v2 failed: " + rc);
            return;
        }

        string key = "7777B48756BA491BB4CEE771A3E2727E";
        byte[] keyBytes = Encoding.UTF8.GetBytes(key);
        rc = sqlite3_key(db, keyBytes, keyBytes.Length);
        if (rc != 0) {
            Console.Error.WriteLine("Error: sqlite3_key failed: " + rc);
            sqlite3_close(db);
            return;
        }

        var callbackPtr = Marshal.GetFunctionPointerForDelegate(new sqlite3_callback(Callback));
        IntPtr errmsg;

        // Try 1: Query by EncryptionKeyId (KGG v5 header hash = EncryptionKeyId)
        string sql = "SELECT id, FileName, FileNamePure, FileSize, ShareFileType, MD5, OriginalHash, " +
                     "EncryptionVersion, EncryptionKeyId, EncryptionKey " +
                     "FROM ShareFileItems WHERE EncryptionKeyId = '" + originalHash + "' " +
                     "AND EncryptionVersion = 5 AND EncryptionKey != '' LIMIT 1";
        _results.Clear();
        rc = sqlite3_exec(db, sql, callbackPtr, IntPtr.Zero, out errmsg);

        if (_results.Count == 0) {
            // Try 2: Query by OriginalHash
            sql = "SELECT id, FileName, FileNamePure, FileSize, ShareFileType, MD5, OriginalHash, " +
                  "EncryptionVersion, EncryptionKeyId, EncryptionKey " +
                  "FROM ShareFileItems WHERE OriginalHash = '" + originalHash + "' " +
                  "AND EncryptionVersion = 5 AND EncryptionKey != '' LIMIT 1";
            _results.Clear();
            rc = sqlite3_exec(db, sql, callbackPtr, IntPtr.Zero, out errmsg);
        }

        if (_results.Count == 0) {
            // Try 3: Query by MD5
            sql = "SELECT id, FileName, FileNamePure, FileSize, ShareFileType, MD5, OriginalHash, " +
                  "EncryptionVersion, EncryptionKeyId, EncryptionKey " +
                  "FROM ShareFileItems WHERE MD5 = '" + originalHash + "' " +
                  "AND EncryptionVersion = 5 AND EncryptionKey != '' LIMIT 1";
            _results.Clear();
            rc = sqlite3_exec(db, sql, callbackPtr, IntPtr.Zero, out errmsg);
        }

        if (_results.Count == 0) {
            // Try 4: Try lowercased hex
            sql = "SELECT id, FileName, FileNamePure, FileSize, ShareFileType, MD5, OriginalHash, " +
                  "EncryptionVersion, EncryptionKeyId, EncryptionKey " +
                  "FROM ShareFileItems WHERE (LOWER(EncryptionKeyId) = LOWER('" + originalHash + "') OR " +
                  "LOWER(OriginalHash) = LOWER('" + originalHash + "') OR " +
                  "LOWER(MD5) = LOWER('" + originalHash + "')) " +
                  "AND EncryptionVersion = 5 AND EncryptionKey != '' LIMIT 1";
            _results.Clear();
            rc = sqlite3_exec(db, sql, callbackPtr, IntPtr.Zero, out errmsg);
        }

        sqlite3_close(db);

        // Output JSON
        if (_results.Count > 0) {
            var r = _results[0];
            Console.Out.WriteLine("{");
            Console.Out.WriteLine("  \"found\": true,");
            Console.Out.WriteLine("  \"id\": " + (r.ContainsKey("id") ? r["id"] : "0") + ",");
            Console.Out.WriteLine("  \"EncryptionVersion\": " + (r.ContainsKey("EncryptionVersion") ? r["EncryptionVersion"] : "0") + ",");
            Console.Out.WriteLine("  \"EncryptionKeyId\": " + JsonEscape(r.ContainsKey("EncryptionKeyId") ? r["EncryptionKeyId"] : "") + ",");
            Console.Out.Write("  \"EncryptionKey\": " + JsonEscape(r.ContainsKey("EncryptionKey") ? r["EncryptionKey"] : ""));
            Console.Out.WriteLine();
            Console.Out.WriteLine("}");
        } else {
            Console.Out.WriteLine("{\"found\": false}");
        }
    }
}
