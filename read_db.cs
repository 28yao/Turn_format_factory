using System;
using System.Runtime.InteropServices;
using System.IO;
using System.Text;

class InfraDB {
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

    public static int Query(sqlite3_callback callback, string sql) {
        var cbPtr = Marshal.GetFunctionPointerForDelegate(callback);
        IntPtr errmsg;
        int rc = sqlite3_exec(_db, sql, cbPtr, IntPtr.Zero, out errmsg);
        if (rc != 0) {
            IntPtr msg = sqlite3_errmsg(_db);
            string errStr = Marshal.PtrToStringAnsi(msg);
            Console.Error.WriteLine("SQL Error: " + errStr);
        }
        return rc;
    }

    static IntPtr _db;

    public static int Callback(IntPtr pArg, int nCols, IntPtr colValues, IntPtr colNames) {
        for (int i = 0; i < nCols; i++) {
            IntPtr valPtr = Marshal.ReadIntPtr(colValues, i * IntPtr.Size);
            IntPtr namePtr = Marshal.ReadIntPtr(colNames, i * IntPtr.Size);
            string name = Marshal.PtrToStringAnsi(namePtr) ?? "";
            string val = valPtr != IntPtr.Zero ? Marshal.PtrToStringAnsi(valPtr) ?? "NULL" : "NULL";
            if (i > 0) Console.Out.Write("|");
            Console.Out.Write(name + "=" + val);
        }
        Console.Out.WriteLine();
        return 0;
    }

    public static void Main(string[] args) {
        // 设置 infra.dll 的搜索目录
        if (args.Length >= 1 && !string.IsNullOrEmpty(args[0])) {
            string infraDir = args[0];
            if (Directory.Exists(infraDir)) {
                SetDllDirectory(infraDir);
            } else {
                Console.Error.WriteLine("Error: infra directory not found: " + infraDir);
                return;
            }
        }
        string dbPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Kugou8", "KGMusicV3.db"
        );

        int rc = sqlite3_open_v2(dbPath, out _db, 1, IntPtr.Zero);
        if (rc != 0 || _db == IntPtr.Zero) return;

        string key = "7777B48756BA491BB4CEE771A3E2727E";
        byte[] keyBytes = Encoding.UTF8.GetBytes(key);
        rc = sqlite3_key(_db, keyBytes, keyBytes.Length);
        if (rc != 0) { sqlite3_close(_db); return; }

        // Look for all audio files (.kgg, .kgm, .flac, .mp3) with encryption info
        Console.Error.WriteLine("=== Files with encryption (kgg/kgm) ===");
        Query(new sqlite3_callback(Callback),
            "SELECT id, FileName, FileNamePure, FileSize, ShareFileType, " +
            "MD5, OriginalHash, EncryptionVersion, EncryptionKeyId, EncryptionKey " +
            "FROM ShareFileItems WHERE FileName LIKE '%.kgg' OR FileName LIKE '%.kgm' LIMIT 30");

        Console.Error.WriteLine("=== All rows with EncryptionKey != empty ===");
        Query(new sqlite3_callback(Callback),
            "SELECT id, FileNamePure, FileSize, ShareFileType, EncryptionVersion, " +
            "substr(EncryptionKey,1,100) AS EncKey, EncryptionKeyId " +
            "FROM ShareFileItems WHERE EncryptionKey != '' LIMIT 30");

        Console.Error.WriteLine("=== Files sorted by size descending (likely audio) ===");
        Query(new sqlite3_callback(Callback),
            "SELECT id, FileNamePure, FileSize, ShareFileType, EncryptionVersion, " +
            "substr(EncryptionKey,1,80) AS EncKey " +
            "FROM ShareFileItems WHERE ShareFileType > 0 ORDER BY FileSize DESC LIMIT 20");

        // Check for SongName table
        Console.Error.WriteLine("=== All tables containing 'Song' or 'Music' ===");
        Query(new sqlite3_callback(Callback),
            "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%Song%' OR name LIKE '%Music%' OR name LIKE '%File%') ORDER BY name");

        sqlite3_close(_db);
    }
}
