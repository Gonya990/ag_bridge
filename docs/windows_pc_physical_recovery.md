# Windows PC physical recovery checklist

This checklist is for the `Igor-Gaming` Windows PC when it is not reachable from the Mac.

## Current known identities

- Tailscale node: `Igor-Gaming`
- Tailscale IPv4: `100.126.23.67`
- LAN candidate A: `192.168.1.217`, MAC `3c:ec:ef:6c:8d:f8`
- LAN candidate B: `192.168.1.218`, MAC `3c:ec:ef:6c:8d:f9`
- RDP profile on Mac: `/Users/igorgoncharenko/Documents/Igor-Gaming.rdp`

## Physical checks

Do these at the PC before any Windows repair action:

1. Confirm the PC is powered on and the PSU switch is on.
2. Check whether fans, motherboard LEDs, or front-panel LEDs turn on.
3. Connect a monitor and confirm what appears: no signal, BIOS/UEFI, boot menu, Windows recovery, login screen, or blue screen.
4. Check the Ethernet port LEDs on the PC and on the switch/router.
5. If there are two Ethernet cables or ports, note which one is connected.
6. If BIOS/UEFI opens, verify the boot disk is visible, but do not change boot order yet.
7. If Windows reaches the login screen, leave it there and rerun `npm run status:family-core` from the Mac.

## Do not do without explicit physical approval

- BIOS flash or firmware update
- Disk format, repartition, or Windows reinstall
- `chkdsk /f`, `bootrec`, `bcdboot`, or bootloader repair
- BitLocker recovery changes
- Account reset, password reset, or profile deletion
- Service disablement, firewall reset, or network stack reset
- Forced shutdown during disk activity

## Expected Mac-side check after the PC is on

Run:

```bash
npm run status:family-core
```

The Windows section should change from:

```text
Windows PC: offline / physical check needed
```

to either a Tailscale online state or at least one LAN candidate with ping, resolved ARP, or an open service port.
