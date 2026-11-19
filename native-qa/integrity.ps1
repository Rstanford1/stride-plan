if (-not ('StrideQaToken' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class StrideQaToken {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, int size, out int needed);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
  public static string Describe(int pid) {
    IntPtr process = IntPtr.Zero, token = IntPtr.Zero, label = IntPtr.Zero, elevation = IntPtr.Zero;
    try {
      process = OpenProcess(0x1000, false, pid);
      if (process == IntPtr.Zero || !OpenProcessToken(process, 8, out token)) throw new Exception();
      int needed;
      GetTokenInformation(token, 25, IntPtr.Zero, 0, out needed);
      if (needed <= 0) throw new Exception();
      label = Marshal.AllocHGlobal(needed);
      if (!GetTokenInformation(token, 25, label, needed, out needed)) throw new Exception();
      IntPtr sid = Marshal.ReadIntPtr(label);
      int count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
      if (count == 0) throw new Exception();
      int rid = Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
      elevation = Marshal.AllocHGlobal(4);
      if (!GetTokenInformation(token, 20, elevation, 4, out needed)) throw new Exception();
      return "integrity=" + rid + " elevated=" + Marshal.ReadInt32(elevation);
    } catch { return "integrity=unavailable elevated=unavailable"; }
    finally {
      if (label != IntPtr.Zero) Marshal.FreeHGlobal(label);
      if (elevation != IntPtr.Zero) Marshal.FreeHGlobal(elevation);
      if (token != IntPtr.Zero) CloseHandle(token);
      if (process != IntPtr.Zero) CloseHandle(process);
    }
  }
}
'@
}
