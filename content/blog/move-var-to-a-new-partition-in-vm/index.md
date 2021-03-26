---
title: "Move /var to a new partition in VM"
date: 2021-01-19T11:26:35+05:30
tags: ["fedora"]
draft: false
---

Well if there's not enough planning in building a resource it'll eat away our productive time when it fails or doesn't work as anticipated. In the current context the effort in migrating `/var` partition might be less but if not done properly may result in data loss!

Current setup before migrating `/var` to new partition:

``` bash {linenos=table, linenostart=1}
-> cat /etc/os-release | grep PRETTY_NAME
PRETTY_NAME="Fedora 32 (Server Edition)"

-> lsblk
NAME               MAJ:MIN RM  SIZE RO TYPE MOUNTPOINT
sda                  8:0    0   80G  0 disk 
├─sda1               8:1    0    1G  0 part /boot
└─sda2               8:2    0   79G  0 part 
  ├─fedora-root    253:0    0   45G  0 lvm  /
  └─fedora-swap    253:1    0  7.9G  0 lvm  [SWAP]

-> df -h
Filesystem               Size  Used Avail Use% Mounted on
devtmpfs                 3.9G     0  3.9G   0% /dev
tmpfs                    3.9G     0  3.9G   0% /dev/shm
tmpfs                    3.9G  1.6M  3.9G   1% /run
tmpfs                    3.9G     0  3.9G   0% /sys/fs/cgroup
/dev/mapper/fedora-root   45G   16G   30G  36% /
tmpfs                    3.9G  4.0K  3.9G   1% /tmp
/dev/sda1               1014M  285M  730M  29% /boot
tmpfs                    786M     0  786M   0% /run/user/0
```

As you can infer from above there's no separate mount for `/var` and currently is part of `/`, however I intend to move `/var` to a different partition for future use. Being a VM running on KVM host below are the steps that'll be followed in brief:
- Create a `qcow2` image and attach to the VM
- Create and mount `xfs` filesystem on newly added disk, `rsync` existing `/var` to newly mounted disc
- Add details in `/etc/fstab` to mount `/var` on reboot

## 1. Attach disk to VM

On a sidenote, if performing partioning on an existing disk please follow this [guide](https://phoenixnap.com/kb/linux-create-partition).
Back to our scenario, create and attach a new disk to the guest machine and perform below on **KVM** machine

``` bash {linenos=table, linenostart=1}
# Change below vars to your needs
-> disk_name=var-disk
-> disk_size=100G
-> vm_name=fedora-32
-> target_disk=sdb

# Get KVM default pool, if using some fancy directoy name please assign to 'pool_path' directly
-> pool_path=$(virsh pool-dumpxml default | grep -Po '(?<=path>)[[:alnum:]/.-]+(?=<)')

# Create 'qcow2' image with required size
-> qemu-img create -o preallocation=metadata -f qcow2 $pool_path/$disk_name $disk_size

# Attach newly created disk to VM
-> virsh attach-disk $vm_name --source $pool_path/$disk_name --target $target_disk --driver qemu --subdriver qcow2 --persistent
```

Verify the disk is created and attached to the **guest** (*Fedora*) machine
``` bash {linenos=table, linenostart=1, hl_lines=[9]}
# On GUEST Machine verify disk is recognized
-> lsblk
NAME               MAJ:MIN RM  SIZE RO TYPE MOUNTPOINT
sda                  8:0    0   80G  0 disk 
├─sda1               8:1    0    1G  0 part /boot
└─sda2               8:2    0   79G  0 part 
  ├─fedora-root    253:0    0   45G  0 lvm  /
  └─fedora-swap    253:1    0  7.9G  0 lvm  [SWAP]
sdb                  8:16   0  100G  0 disk
```

## 2. Create a file system on the disk

After adding disk to VM, you can follow this [guide](https://www.tecmint.com/manage-and-create-lvm-parition-using-vgcreate-lvcreate-and-lvextend/) until creation of filesystem, cause in our scenrio we are creating an `xfs` filesystem. Perform `mkfs.xfs /dev/vg1/lv1` on host VM and a new filesystem will be created on the disk.

If incase you want to use already existing disk and create `xfs` on it, wipe (**WARNING**: potential data loss) existing file system headers by running `wipefs -a <disk>` and create new filesystem on that.

``` bash {linenos=table, linenostart=1, hl_lines=[9,10]}
# On Guest (VM) verify volume group is created
-> lsblk
NAME               MAJ:MIN RM  SIZE RO TYPE MOUNTPOINT
sda                  8:0    0   80G  0 disk 
├─sda1               8:1    0    1G  0 part /boot
└─sda2               8:2    0   79G  0 part 
  ├─fedora-root    253:0    0   45G  0 lvm  /
  └─fedora-swap    253:1    0  7.9G  0 lvm  [SWAP]
sdb                  8:16   0  100G  0 disk
└─vg1-lv1          253:2    0  100G  0 lvm
```

\*If you wish not to go through all the hassle of creating LVM, you can simply run `mkfs.xfs` on new disk.

## 3. Sync `/var` to new disk

We will mount new disk and to avoid any data writes we'll be dropping to [runlevel](https://developer.ibm.com/technologies/linux/tutorials/l-lpic1-101-3/) 1 and perform `rsync` data of `/var` to mounted disk

``` bash {linenos=table, linenostart=1, hl_lines=[9, 32]}
-> mkdir /mnt/new-dir
-> mount /dev/mapper/vg1-lv1 /mnt/new-dir

# Drop to single user mode
-> telinit 1

# Check the runlevel and take note of last runlevel
-> who -r
         run-level 1  2021-01-20 07:49                   last=3

# rsync (or 'cp' also would work the same) 'var' contents to '/mnt/new-dir'
-> rsync -aqxp /var/* /mnt/new-dir/

# Rename '/var'
-> mv /var /var.old && mkdir /var

# Take note of UUID of LVM
-> UUID=$(blkid /dev/mapper/vg1-lv1 | grep -oP '(?<=UUID=").*?(?=")')

# Add entry in '/etc/fstab'
-> echo UUID=$UUID /var xfs defaults 0 0 >> /etc/fstab

# Unmount /mnt/new-dir and mount '/var' as mentioned in '/etc/fstab'
-> umount /mnt/new-dir
-> mount -a

# IMP: Restore SELinux labels on newly mounted partition
-> restorecon -R /var

# It's best to reboot the server to ascertain no errors
# Go to multi user mode (revert to last runlevel from line #9) and reboot the server
-> telinit 3 # ('last=3' in line #9, in GUI environment it's typically '5')
-> reboot
```

If everything checks out well, server should reboot without any issues with `/var` mounted as per `/etc/fstab` entries.

## Verification and minimal troubleshoot

After server restarts `mount | grep var` should be successfull, `df -h` should list `/var` being mounted on different filesystem and `lsblk` stating `/var` on lvm

Below is the info after migration:

``` bash {linenos=table, linenostart=1, hl_lines=[2,14,23,24]}
-> mount | grep var
/dev/mapper/vg1-lv1 on /var type xfs (rw,relatime,seclabel,attr2,inode64,logbufs=8,logbsize=32k,noquota)

-> df -h
Filesystem               Size  Used Avail Use% Mounted on
devtmpfs                 3.9G     0  3.9G   0% /dev
tmpfs                    3.9G     0  3.9G   0% /dev/shm
tmpfs                    3.9G  1.6M  3.9G   1% /run
tmpfs                    3.9G     0  3.9G   0% /sys/fs/cgroup
/dev/mapper/fedora-root   45G   16G   30G  36% /
tmpfs                    3.9G  4.0K  3.9G   1% /tmp
/dev/sda1               1014M  285M  730M  29% /boot
tmpfs                    786M     0  786M   0% /run/user/0
/dev/mapper/vg1-lv1      100G  3.8G   97G   4% /var

-> lsblk
NAME               MAJ:MIN RM  SIZE RO TYPE MOUNTPOINT
sda                  8:0    0   80G  0 disk 
├─sda1               8:1    0    1G  0 part /boot
└─sda2               8:2    0   79G  0 part 
  ├─fedora-root    253:0    0   45G  0 lvm  /
  └─fedora-swap    253:1    0  7.9G  0 lvm  [SWAP]
sdb                  8:16   0  100G  0 disk 
└─vg1-lv1          253:2    0  100G  0 lvm  /var
```

If for some reason the server didn't come up as expected, login to VM via console connection (virt-manager) from KVM and perform below:

``` bash {linenos=table, linenostart=1}
# Backup and remove newly added entry in /etc/fstab
-> cp /etc/fstab /etc/fstab.old
-> head -n -1 /etc/fstab.old > /etc/fstab

# Unmount '/var' and rename old directory (from previous step) to '/var'
-> umount /var && mv -f /var.old /var

# Reboot server and compare info against before migration, it should match
-> reboot
```

Many services use `/var` for log messages and storing data apart from configs, it's always a good idea particulary in server environments to have a healthy amount of free space available in `/var` directory.

All above steps are performed and verified on **Fedora 32 Server Edition** as part of making space for container images and related volume mounts.

Hope your time is well spent and leave feedback or ask for any help in comments secion.:smile:

So long :wave:
