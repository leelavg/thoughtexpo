---
title: "Exploring Kadalu Storage in k3d Cluster - GlusterFS"
date: 2021-08-12T08:09:46+05:30
tags: ["kubernetes", "kadalu"]
draft: false
---

Like less lines of code might not always be considered as an optimization, a lengthy post need not to be viewed as a complex one to follow :smile:.

For this blog post I'll be strictly adhering to the part of title '**Exploring**' and go through how we can learn by experimenting and observing the outcome in each stage.

Although it's a bit easier for me to state above considering I know most (not actual gluster per-se :wink:) of the inner workings, I'll try my best not to deviate from simplicity and so will not be presenting any code walk-through.

Let's address this first, '[GlusterFS](https://www.gluster.org/)' is a widely adopted distributed and scalable network filesystem among enterprises and individual users with a lot of features, so I couldn't possibly explain how gluster works without cutting any corners. Only when it's absolutely necessary I'll be expanding on gluster side workings.

Previously we looked into [Operator](https://thoughtexpo.com/exploring-kadalu-storage-in-k3d-cluster-operator/) and [CSI](https://thoughtexpo.com/exploring-kadalu-storage-in-k3d-cluster-operator/) components and this post fills the gap between those two and completes the series.

## Introduction

From perspective of an application developer/user, they need a persistent storage when asked for one and doesn't bother about how and where the storage is being served.

We'll be looking from creation of kubernetes cluster to fulfilling the user request of supplying persistent storage. Before we start off, let's look into some of the terminologies for understanding functionalities mentioned in rest of the post.

### Terminologies

**1. Gluster Deployment:**
- **Internal:** Kadalu operator takes care of gluster volume life cycle and deploys containerized gluster server/client pods
- **External:** User has to manage gluster volume creation, deletion and gluster server typically resides outside of kubernetes and internal gluster only used as a client (~fuse mount) in this case

**2. Storage:**
- **Storage Pool:** Combination of gluster bricks served from internal gluster from which Persistent Volumes (PVs) are provided to end user
- **Volumes:** Used to signify PVs in this blog post
- **Gluster Volume:** Represents external gluster volume managed by user

**3. Quota:**
- **Simple Quota:** Used by internal gluster and is a part of kadalu's [fork](https://github.com/kadalu/glusterfs/tree/series_1/xlators/features/simple-quota) of upstream glusterfs. You can refer [this](https://kadalu.io/rfcs/0006-optimized-quota-feature-with-namespace.html) rfc to learn more
- **Kadalu Quotad:** Typically runs as a [daemon](https://github.com/kadalu/kadalu/tree/devel/server) process in external gluster server to help internal simple quota set xattrs correctly. This can only work for gluster volumes which are of non-distributed type
- **Gluster Quota:** Kadalu can delegate quota operations to gluster native quota when an [SSH Key Pair](https://github.com/kadalu/kadalu/blob/b8e9c5f/doc/external-gluster-storage.adoc#using-glusterfs-directory-quota-to-set-capacity-limitation-for-external-gluster-volumes) is added in Kadalu namespace before deploying the operator

**4. Kadalu Format:**
- **native:** Default option for `kadalu_format` in storage pool config. In this format, each volume (~pvc) is created as a fuse-subdir and thus support volume expansion as well
- **non-native:** When `kadalu_format` is set to `non-native`, whole storage pool can be used only for single pvc and so no expansion is possible (unless you hack on underlying bricks :sweat_smile:)

Now, we can proceed with creation of kubernetes cluster using k3d. Kadalu can create storage pool backed by raw devices or xfs mounted paths or any available PVC in k8s cluster. For more info please refer kadalu [docs](https://kadalu.io/docs/k8s-storage/devel/quick-start/)

I'll be using 3 of my devices from host and for rest of the post, server and agent docker containers created by k3d can be considered as k8s master and worker nodes respectively.

At the time of publishing this post, the last commit to kadalu repo is [b8e9c5f](https://github.com/kadalu/kadalu/tree/b8e9c5f), latest release is 0.8.4 and features mentioned here if not released already will be part of next release.

## K3D Cluster

As simple as it gets, k3d makes it very easy to create kubernetes cluster running k3s. I created mine with below command, snippet is from [here](https://github.com/leelavg/forge/blob/9956cbe/adhoc/k3d-kadalu.sh#L110-L120):

``` sh
# Number of worker nodes
agents=3

# Pods need a shared mount
mkdir -p /tmp/k3d/kubelet/pods

# Create k3d test cluster
k3d cluster create test -a $agents \
    -v /tmp/k3d/kubelet/pods:/var/lib/kubelet/pods:shared \
    -v /dev/sdc:/dev/sdc -v /dev/sdd:/dev/sdd \
    -v /dev/sde:/dev/sde \
    -v ~/.k3d/registries.yaml:/etc/rancher/k3s/registries.yaml \
    --k3s-server-arg "--kube-apiserver-arg=feature-gates=EphemeralContainers=true" \
    --k3s-server-arg --disable=local-storage
```

We can see single server (control-plane) with three agents.
``` sh {linenos=table,hl_lines=[8],linenostart=1}
-> kubectl get ns
NAME              STATUS   AGE
default           Active   3m39s
kube-system       Active   3m39s
kube-public       Active   3m39s
kube-node-lease   Active   3m39s

-> kubectl get nodes -o wide
NAME                STATUS   ROLES                  AGE     VERSION        INTERNAL-IP   EXTERNAL-IP   OS-IMAGE   KERNEL-VERSION            CONTAINER-RUNTIME
k3d-test-server-0   Ready    control-plane,master   3m39s   v1.21.2+k3s1   172.18.0.2    <none>        Unknown    5.12.14-300.fc34.x86_64   containerd://1.4.4-k3s2
k3d-test-agent-0    Ready    <none>                 3m39s   v1.21.2+k3s1   172.18.0.3    <none>        Unknown    5.12.14-300.fc34.x86_64   containerd://1.4.4-k3s2
k3d-test-agent-1    Ready    <none>                 3m39s   v1.21.2+k3s1   172.18.0.4    <none>        Unknown    5.12.14-300.fc34.x86_64   containerd://1.4.4-k3s2
k3d-test-agent-2    Ready    <none>                 3m39s   v1.21.2+k3s1   172.18.0.6    <none>        Unknown    5.12.14-300.fc34.x86_64   containerd://1.4.4-k3s2

-> kubectl version --short=true
Client Version: v1.20.2
Server Version: v1.21.2+k3s1
```

## Kadalu Setup

We'll create a secret before deploying kadalu to be used with external gluster towards the end of the post.

``` sh {linenos=table,hl_lines=[4,12],linenostart=1}
-> kubectl create namespace kadalu
namespace/kadalu created

-> kubectl create secret generic glusterquota-ssh-secret --from-literal=glusterquota-ssh-username=root --from-file=ssh-privatekey=/root/.ssh/id_rsa -n kadalu
secret/glusterquota-ssh-secret created

-> kubectl config set-context --current --namespace=kadalu

-> kubectl get all
No resources found in kadalu namespace.

-> kubectl get csidrivers
No resources found
```

There are no CSIDrivers currently deployed (above, line 12)

``` sh {linenos=table,hl_lines=[2,15],linenostart=1}
# Warning can be ignored here
-> curl -s https://raw.githubusercontent.com/kadalu/kadalu/devel/manifests/kadalu-operator.yaml | sed 's/"no"/"yes"/' | kubectl apply -f -
Warning: resource namespaces/kadalu is missing the kubectl.kubernetes.io/last-applied-configuration annotation which is required by kubectl apply. kubectl apply should only be used on resources created declaratively by either kubectl create --save-config or kubectl apply. The missing annotation will be patched automatically.
namespace/kadalu configured
serviceaccount/kadalu-operator created
serviceaccount/kadalu-csi-nodeplugin created
serviceaccount/kadalu-csi-provisioner created
serviceaccount/kadalu-server-sa created
customresourcedefinition.apiextensions.k8s.io/kadalustorages.kadalu-operator.storage created
clusterrole.rbac.authorization.k8s.io/pod-exec created
clusterrole.rbac.authorization.k8s.io/kadalu-operator created
clusterrolebinding.rbac.authorization.k8s.io/kadalu-operator created
deployment.apps/operator created

-> curl -s https://raw.githubusercontent.com/kadalu/kadalu/devel/manifests/csi-nodeplugin.yaml | sed 's/"no"/"yes"/' | kubectl apply -f -
clusterrole.rbac.authorization.k8s.io/kadalu-csi-nodeplugin created
clusterrolebinding.rbac.authorization.k8s.io/kadalu-csi-nodeplugin created
daemonset.apps/kadalu-csi-nodeplugin created

-> kubectl get all
NAME                              READY   STATUS    RESTARTS   AGE
pod/operator-88bd4784c-4ldbv      1/1     Running   0          115s
pod/kadalu-csi-provisioner-0      5/5     Running   0          110s
pod/kadalu-csi-nodeplugin-pzbf7   3/3     Running   0          95s
pod/kadalu-csi-nodeplugin-chc7d   3/3     Running   0          95s
pod/kadalu-csi-nodeplugin-lf5ml   3/3     Running   0          95s
pod/kadalu-csi-nodeplugin-6hlw9   3/3     Running   0          95s

NAME                                   DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE
daemonset.apps/kadalu-csi-nodeplugin   4         4         4       4            4           <none>          95s

NAME                       READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/operator   1/1     1            1           115s

NAME                                 DESIRED   CURRENT   READY   AGE
replicaset.apps/operator-88bd4784c   1         1         1       115s

NAME                                      READY   AGE
statefulset.apps/kadalu-csi-provisioner   1/1     110s
```
Installation is split into two manifests to ease upgrades and at the same time, there's still room for improvement here. Typical kubernetes deployment can be seen above, operator reconciled the state and created provisioner, all necessary RBAC permissions.

Later, nodeplugin is deployed as a daemonset which will be running on every node. Usage of `sed` in above listing is just to trigger `verbose` logging.

Let's see what else is deployed and look at resources which are important to us.

``` sh {linenos=table,hl_lines=[1,5,21,24],linenostart=1}
-> kubectl get csidriver
NAME     ATTACHREQUIRED   PODINFOONMOUNT   STORAGECAPACITY   TOKENREQUESTS   REQUIRESREPUBLISH   MODES        AGE
kadalu   true             false            false             <unset>         false               Persistent   72s

-> kubectl describe cm kadalu-info 
Name:         kadalu-info
Namespace:    kadalu
Labels:       <none>
Annotations:  <none>

Data
====
uid:
----
f6689df0-c4e3-4ecb-a9d4-d788f0edd487
volumes:
----

Events:  <none>

-> kubectl get sc
No resources found

-> kubectl get kds
No resources found in kadalu namespace.
```

At this point csidriver (line 1) and `kadalu-info` config map (line 23) is easily the most important resources. `PODINFOONMOUNT` should've be `true` and will deliver [more](https://kubernetes-csi.github.io/docs/csi-driver-object.html) info in gRPC calls to kadalu csi driver.

With release of kubernetes v1.22, GVK (Group, Version, Kind) of many important resources needs to be updated and above will be fixed in that.

Internal gluster uses neither `glusterd` nor `gluster cli`. Operator fills up `kadalu-info` dynamically while performing operations based on storage pool and internal gluster reads `kadalu-info` and constructs necessary volfiles.

We can see no storage classes (line 21) and no kds (short for kadalustorages, line 24) yet.

By the end of this stage, if we are facing any issues or any of above pods aren't in ready state, logs in operator followed by `kadalu-provisioner` container in `kadalu-csi-provisioner-0` pod and `kadalu-nodeplugin` in `kadalu-csi-nodeplugin-*` pods need to be looked for finding the issue.

## Storage Operations

We'll deploy internal gluster and connect to gluster as well and perform volume operations.

### Internal Gluster

All operations performed here are described in detail so that by the time we reach looking into external gluster ops, we'll have a good understanding how things work internally.

#### Pool Creation

We'll deploy a storage pool of `Replica3` type and look at all the resources that are created. Internal gluster supports storage pools of below types:
- Pure distribute (`Replica1`)
- `Replica2`, `Replica3`
- `Disperse`

If we supply two multiples of disks, a distributed storage pool is created.

Please refer inline comments in below listing

``` sh {linenos=table,hl_lines=[1,2,20,35,36,"56-58","85-88"],linenostart=1}
# Our intention is to create a storage pool of type `Replica3` using devices
# spread across three nodes.
-> bat --plain ../storage-config-device.yaml | tee /dev/tty | kubectl apply -f -
---
apiVersion: kadalu-operator.storage/v1alpha1
kind: KadaluStorage
metadata:
  name: replica3
spec:
  type: Replica3
  storage:
    - node: k3d-test-agent-0
      device: /dev/sdc
    - node: k3d-test-agent-1
      device: /dev/sdd
    - node: k3d-test-agent-2
      device: /dev/sde
kadalustorage.kadalu-operator.storage/replica3 created

# One `server` pod per `device` (~brick) is created and a Headless Service is deployed with it.
-> kubectl get all -l app.kubernetes.io/component=server -o wide
NAME                      READY   STATUS    RESTARTS   AGE   IP           NODE               NOMINATED NODE   READINESS GATES
pod/server-replica3-0-0   1/1     Running   0          20s   10.42.1.15   k3d-test-agent-0   <none>           <none>
pod/server-replica3-1-0   1/1     Running   0          20s   10.42.2.11   k3d-test-agent-1   <none>           <none>
pod/server-replica3-2-0   1/1     Running   0          19s   10.42.3.8    k3d-test-agent-2   <none>           <none>

NAME               TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)     AGE   SELECTOR
service/replica3   ClusterIP   None         <none>        24007/TCP   18s   app.kubernetes.io/component=server,app.kubernetes.io/name=server,app.kubernetes.io/part-of=kadalu

NAME                                 READY   AGE   CONTAINERS   IMAGES
statefulset.apps/server-replica3-0   1/1     20s   server       docker.io/kadalu/kadalu-server:devel
statefulset.apps/server-replica3-1   1/1     20s   server       docker.io/kadalu/kadalu-server:devel
statefulset.apps/server-replica3-2   1/1     19s   server       docker.io/kadalu/kadalu-server:devel

# We can contact each `server` pod at below mentioned `Endpoints` or resolve to them using
# their DNS name and k8s will internally handle the dns query
-> kubectl describe svc
Name:              replica3
Namespace:         kadalu
Labels:            app.kubernetes.io/component=server
                   app.kubernetes.io/name=replica3-service
                   app.kubernetes.io/part-of=kadalu
Annotations:       <none>
Selector:          app.kubernetes.io/component=server,app.kubernetes.io/name=server,app.kubernetes.io/part-of=kadalu
Type:              ClusterIP
IP Family Policy:  SingleStack
IP Families:       IPv4
IP:                None
IPs:               None
Port:              brickport  24007/TCP
TargetPort:        24007/TCP
Endpoints:         10.42.1.15:24007,10.42.2.11:24007,10.42.3.8:24007
Session Affinity:  None
Events:            <none>

# Below are the backend 'data' bricks and it can be referred that an xfs filesytem is created
# on the supplied device and mounted at '/bricks/<storage-pool-name>/data`'
# please observe kadalu-info configmap in next listing to find this path
-> for i in 0 1 2; do kubectl exec -it server-replica3-$i-0 -- sh -c 'hostname; df -hT | grep bricks; ls -lR /bricks/replica3/data'; done;
server-replica3-0-0
/dev/sdc            xfs        10G  104M  9.9G   2% /bricks/replica3/data
/bricks/replica3/data:
total 0
drwxr-xr-x. 3 root root 24 Aug 11 05:38 brick

/bricks/replica3/data/brick:
total 0
server-replica3-1-0
/dev/sdd            xfs        10G  104M  9.9G   2% /bricks/replica3/data
/bricks/replica3/data:
total 0
drwxr-xr-x. 3 root root 24 Aug 11 05:38 brick

/bricks/replica3/data/brick:
total 0
server-replica3-2-0
/dev/sde            xfs        10G  104M  9.9G   2% /bricks/replica3/data
/bricks/replica3/data:
total 0
drwxr-xr-x. 3 root root 24 Aug 11 05:38 brick

/bricks/replica3/data/brick:
total 0

# After creation of storage pool, above pods & services are deployed and a directory
# structure is created in backend brick but nothing can be seen in `provisioner` and
# `nodeplugin` yet. Just showing `secret-volume` below which holds SSH Key Pair info
# of external gluster
-> kubectl exec -it kadalu-csi-provisioner-0 -c kadalu-provisioner -- sh -c 'df -h | grep -P secret'
tmpfs                3.9G  8.0K  3.9G   1% /etc/secret-volume
tmpfs                3.9G   12K  3.9G   1% /run/secrets/kubernetes.io/serviceaccount

-> kubectl exec -it kadalu-csi-provisioner-0 -c kadalu-provisioner -- sh -c 'df -h | grep kadalu'
command terminated with exit code 1
```

As we didn't touch either `provisioner` or `nodeplugin` we should still look for any errors in operator, server logs. Before moving further, using `busybox` in `provisioner` pod, please confirm the access to `server` pods.

``` sh {linenos=table,hl_lines=[1],linenostart=1}
# Ping should be successfully and port `24007` should be reachable
-> kubectl exec -it sts/kadalu-csi-provisioner -c kadalu-logging -- sh -c 'ping -c 5 server-replica3-0-0.replica3; nc -zv server-replica3-0-0.replica3 24007'
PING server-replica3-0-0.replica3 (10.42.1.15): 56 data bytes
64 bytes from 10.42.1.15: seq=0 ttl=62 time=13.834 ms
64 bytes from 10.42.1.15: seq=1 ttl=62 time=0.319 ms
64 bytes from 10.42.1.15: seq=2 ttl=62 time=0.350 ms
64 bytes from 10.42.1.15: seq=3 ttl=62 time=0.286 ms
64 bytes from 10.42.1.15: seq=4 ttl=62 time=0.311 ms

--- server-replica3-0-0.replica3 ping statistics ---
5 packets transmitted, 5 packets received, 0% packet loss
round-trip min/avg/max = 0.286/3.020/13.834 ms
server-replica3-0-0.replica3 (10.42.1.15:24007) open
```

Please refer [this](https://github.com/kadalu/kadalu/issues/614#issuecomment-895797501) workaround if you face any issues contacting `server` pods, especially if you deployed kubernetes in vmware machines.

Next stop to find out how `server` pod is able to pick up correct devices and performed necessary operations on those. For simplicity, I'm not showing `gluster` process in any of the pods and so consider whenever there's a mount (of type XFS) available on `server` or a mount (of type fuse.glusterfs) on any of `provisioner`/`nodeplugin`/`app` pods then `glusterfs` as a daemon will be running on those containers.

Read about the magic, [here](https://kadalu.io/blog/gluster-and-k8s-portmap/) and [here](https://medium.com/@tumballi/kadalu-ocean-of-potential-in-k8s-storage-a07be1b8b961) then it'll not be a magic anymore :joy:.


``` sh {linenos=table,hl_lines=["1-4"],linenostart=1}
# This here, I'd say is the most important piece gluing operator, server and csi pods.
# Right off the bat you can see all the required info needed to create a volfile which
# when supplied to glusterfs binary does what it does the best, pooling storage and
# serving it under a single namespace

# Json formatted with 'python -mjson.tool' for readability
-> kubectl describe cm kadalu-info
Name:         kadalu-info
Namespace:    kadalu
Labels:       <none>
Annotations:  <none>

Data
====
volumes:
----

replica3.info:
----
{
    "namespace": "kadalu",
    "kadalu_version": "devel",
    "volname": "replica3",
    "volume_id": "5e39a614-fa66-11eb-a07e-56a8d556e557",
    "kadalu_format": "native",
    "type": "Replica3",
    "pvReclaimPolicy": "delete",
    "bricks": [
        {
            "brick_path": "/bricks/replica3/data/brick",
            "kube_hostname": "k3d-test-agent-0",
            "node": "server-replica3-0-0.replica3",
            "node_id": "node-0",
            "host_brick_path": "",
            "brick_device": "/dev/sdc",
            "pvc_name": "",
            "brick_device_dir": "",
            "decommissioned": "",
            "brick_index": 0
        },
        {
            "brick_path": "/bricks/replica3/data/brick",
            "kube_hostname": "k3d-test-agent-1",
            "node": "server-replica3-1-0.replica3",
            "node_id": "node-1",
            "host_brick_path": "",
            "brick_device": "/dev/sdd",
            "pvc_name": "",
            "brick_device_dir": "",
            "decommissioned": "",
            "brick_index": 1
        },
        {
            "brick_path": "/bricks/replica3/data/brick",
            "kube_hostname": "k3d-test-agent-2",
            "node": "server-replica3-2-0.replica3",
            "node_id": "node-2",
            "host_brick_path": "",
            "brick_device": "/dev/sde",
            "pvc_name": "",
            "brick_device_dir": "",
            "decommissioned": "",
            "brick_index": 2
        }
    ],
    "disperse": {
        "data": 0,
        "redundancy": 0
    },
    "options": {}
}

uid:
----
f6689df0-c4e3-4ecb-a9d4-d788f0edd487
Events:  <none>
```

#### Volume Operations

We have a storage pool available ready to be used, however if we look around carefully, we'll find two more important resources are created and one being a `storageClass` the de-facto in kubernetes for carving dynamics PVCs.

``` sh {linenos=table,hl_lines=[1,2,3],linenostart=1}
# Moment of truth, this is what we finally want a 'storageClass' to create PV
# Look at 'ALLOWVOLUMEEXPANSION', it's set to 'true' as we deployed 'kadalu_format' in 'native' mode in storage pool config
# Observe the naming, name of storage pool is 'replica3' and it deploys a 'sc' with name 'kadalu.replica3'
-> kubectl get kds,sc
NAME                                             AGE
kadalustorage.kadalu-operator.storage/replica3   31m

NAME                                          PROVISIONER   RECLAIMPOLICY   VOLUMEBINDINGMODE   ALLOWVOLUMEEXPANSION   AGE
storageclass.storage.k8s.io/kadalu.replica3   kadalu        Delete          Immediate           true                   31m

# As expected no PV or PVC yet
-> kubectl get pv,pvc
No resources found
```

Even at this stage, if there are any issues operator logs need to be referred. Onto the next stage with carving PVC from storage pool.

We can create a PVC from `kadalu.replica3` storageClass and let's observe what all resources are created and what changes happen in CSI pods.

``` yaml {linenos=table,hl_lines=[1,"18-20","28-37"],linenostart=1}
# Ask for an 1Gi pvc from 'kadalu.replica3' storageClass
-> bat --plain ../sample-pvc.yaml -r :13 | tee /dev/tty | kubectl apply -f -
# File: sample-pvc.yaml
---
kind: PersistentVolumeClaim
apiVersion: v1
metadata:
  name: replica3-pvc
spec:
  storageClassName: kadalu.replica3
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 1Gi
persistentvolumeclaim/replica3-pvc created

# PVC is created and PV is bounded to dynamically created PVC
# Observe 'RECLAIM POLICY', currently it's 'Delete', if we want to retain PVC when a delete request is
# received on it, storage pool need to created with 'pvReclaimPolicy' as 'archive'
-> kubectl get pv,pvc
NAME                                                        CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM                 STORAGECLASS      REASON   AGE
persistentvolume/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7   1Gi        RWX            Delete           Bound    kadalu/replica3-pvc   kadalu.replica3            42s

NAME                                 STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS      AGE
persistentvolumeclaim/replica3-pvc   Bound    pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7   1Gi        RWX            kadalu.replica3   43s

# Now things start to change in 'provisioner', the sidecar (csi-provisioner) listens to k8s api-server
# sends gRPC call to 'kadalu-provisioner' for creation of PVC
-> kubectl exec -it kadalu-csi-provisioner-0 -c kadalu-provisioner -- bash
root@kadalu-csi-provisioner-0:/# df -hT | grep kadalu
kadalu:replica3     fuse.glusterfs   10G  207M  9.8G   3% /mnt/replica3
root@kadalu-csi-provisioner-0:/# ls /mnt/replica3/
info  stat.db  subvol
root@kadalu-csi-provisioner-0:/# ls /mnt/replica3/subvol/c3/02/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7/
root@kadalu-csi-provisioner-0:/# cat /mnt/replica3/info/subvol/c3/02/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7.json 
{"size": 1073741824, "path_prefix": "subvol/c3/02"}root@kadalu-csi-provisioner-0:/#
```
Referring above listing we can deduct:
1. Except `glusterfs` process in `server` pod, `glusterfs` process will be acting as a client (~mount) in other (provisioner/nodeplugin/app) pods
2. Filesystem `kadalu:<storage-pool>` of type `fuse.glusterfs` is mounted on `/mnt/<storage-pool>`
3. Storage pool has three entries:
    - info: Holds subvol info and mirrors subvol directory structure but at the leaf it'll have pvc info (in json format)
    - stat.db: Holds pvc entries and summary tables which belong to the storage pool, used in pretty interesting ways in [kubectl_kadalu](https://github.com/kadalu/kadalu/tree/devel/cli) among other places
    - subvol: At the leaf contains actual PVC directory and currently it's empty as expected

Most of the operations happen in `kadalu-csi-provisioner-0` pod and should be looked for errors if PVC is stuck in pending state. If logs are clean and issue still persist, `server` pod logs should be analysed.

#### Sample App

Now we got a PVC, let's use it in an app pod and observe changes that happen predominantly in nodeplugin and find out all the places we can access data.

``` yaml {linenos=table,hl_lines=[1,27,32,37,38,"48-51"],linenostart=1}
# Normal 'busybox' but with a volume mount referring to above created PVC
-> bat --plain ../sample-app.yaml -r :22 | tee /dev/tty | kubectl apply -f -
# File: sample-app.yaml
---
apiVersion: v1
kind: Pod
metadata:
  name: replica3-pvc-pod
spec:
  containers:
  - name: replica3-pvc-pod
    image: busybox
    imagePullPolicy: IfNotPresent
    command:
      - '/bin/tail'
      - '-f'
      - '/dev/null'
    volumeMounts:
    - mountPath: '/mnt/replica3-pvc'
      name: replica3-pvc
  volumes:
  - name: replica3-pvc
    persistentVolumeClaim:
      claimName: replica3-pvc
pod/replica3-pvc-pod created

# Pod is scheduled on node 'k3d-test-server-0', let's find nodeplugin which is running on that node
-> kubectl get pods replica3-pvc-pod -o wide
NAME               READY   STATUS    RESTARTS   AGE   IP          NODE                NOMINATED NODE   READINESS GATES
replica3-pvc-pod   1/1     Running   0          50s   10.42.0.8   k3d-test-server-0   <none>           <none>

# We are interested in below nodeplugin
-> kubectl get pods -o wide | grep k3d-test-server-0
kadalu-csi-nodeplugin-6hlw9   3/3     Running   0          95m   10.42.0.6    k3d-test-server-0   <none>           <none>
replica3-pvc-pod              1/1     Running   0          20m   10.42.0.8    k3d-test-server-0   <none>           <none>

# Wait a sec, why do nodeplugin also has whole storage pool mounted, but not only the PVC?
# Remember, we use fuse-subdir functionality of glusterfs to only surface required PVC to app pod
-> kubectl exec -it kadalu-csi-nodeplugin-6hlw9 -c kadalu-nodeplugin -- bash
root@kadalu-csi-nodeplugin-6hlw9:/# df -hT | grep kadalu
kadalu:replica3     fuse.glusterfs   10G  207M  9.8G   3% /mnt/replica3
root@kadalu-csi-nodeplugin-6hlw9:/# ls /mnt/replica3/
info  stat.db  subvol
root@kadalu-csi-nodeplugin-6hlw9:/# ls /mnt/replica3/subvol/c3/02/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7/
root@kadalu-csi-nodeplugin-6hlw9:/# cat /mnt/replica3/info/subvol/c3/02/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7.json
{"size": 1073741824, "path_prefix": "subvol/c3/02"}root@kadalu-csi-nodeplugin-6hlw9:/#

# Before traversing how pvc is surfaced to app pod, let's write some data to the mount
# Ok, nodeplugin saw whole storage pool but app pod is seeing only 1Gi with same filesystem name?
# We'll look how above is possible in next listing
# Anyways, we can see an increase of 100M and is also reflected in nodeplugin as well
->  k exec -it replica3-pvc-pod -- sh
/ # df -hT | grep kadalu
kadalu:replica3      fuse.glusterfs  1.0G         0      1.0G   0% /mnt/replica3-pvc
/ # cd /mnt/replica3-pvc/
/mnt/replica3-pvc # cat /dev/urandom | tr -dc [:space:][:print:] | head -c 100m > 100Mfile;
/mnt/replica3-pvc # df -h | grep kadalu
kadalu:replica3           1.0G    100.0M    924.0M  10% /mnt/replica3-pvc

-> kubectl exec -it kadalu-csi-nodeplugin-6hlw9 -c kadalu-nodeplugin -- sh -c 'df -hT | grep kadalu'
kadalu:replica3     fuse.glusterfs   10G  307M  9.7G   3% /mnt/replica3
```

Well, most of the resources has an associated uid and let's start from there to find out what kubelet did for replica3-pvc-pod to have access to only 1Gi of storage pool and role of nodeplugin as well.

``` sh {linenos=table,hl_lines=[1,11,12,20,"24-26"],linenostart=1}
# We get the uid's and hunt for volumes mounted in pods by travesing corresponding 'kubelet' volumes directory
-> kubectl get pods -o=custom-columns='NAME:.metadata.name,NODE:.spec.nodeName,UID:.metadata.uid' | grep -P 'provisioner|nodeplugin-6hlw9|replica3-pvc'
kadalu-csi-provisioner-0      k3d-test-agent-2    c92d4fa9-90cf-46a5-8bd6-93aeebaca6a9
kadalu-csi-nodeplugin-6hlw9   k3d-test-server-0   98166ddd-5157-4572-ba6c-0a577efd6127
replica3-pvc-pod              k3d-test-server-0   4ad3ba8c-457e-4b81-9404-b793967165b2

-> kubectl get pvc
NAME           STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS      AGE
replica3-pvc   Bound    pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7   1Gi        RWX            kadalu.replica3   3h10m

# Entries in nodes running 'nodeplugin' and 'provisioner' pods are not interesting
# They are self-explanatory and 'projected' just holds access keys for api-server
-> docker exec -it k3d-test-agent-2 sh -c 'ls /var/lib/kubelet/pods/c92d4fa9-90cf-46a5-8bd6-93aeebaca6a9/volumes'
kubernetes.io~configmap  kubernetes.io~projected
kubernetes.io~empty-dir  kubernetes.io~secret

-> docker exec -it k3d-test-server-0 sh -c 'ls /var/lib/kubelet/pods/98166ddd-5157-4572-ba6c-0a577efd6127/volumes'
kubernetes.io~configmap  kubernetes.io~empty-dir  kubernetes.io~projected

# Entry 'kubernetes.io~csi' is interesting for us and this uid belongs to app pod (replica3-pvc-pod)
-> docker exec -it k3d-test-server-0 sh -c 'ls /var/lib/kubelet/pods/4ad3ba8c-457e-4b81-9404-b793967165b2/volumes'
kubernetes.io~csi  kubernetes.io~projected

# We (nodeplugin running on node where 'replica3-pvc-pod' to be scheduled) received a request to mount pvc at 'target_path'
# 'kubelet' waits for nodeplugin to respond and after confirming that mount is available app pod is scheduled to that node
# Btw, 'nodeplugin' only mounts PVC subdir and that is limited to 1Gi by simple-quota and surfaced to 'replica3-pvc-pod'
-> kubectl logs kadalu-csi-nodeplugin-6hlw9 -c kadalu-nodeplugin | sed -n '/Received/,/Mounted PV/p'
[2021-08-11 06:51:41,627] DEBUG [nodeserver - 71:NodePublishVolume] - Received a valid mount request     request=volume_id: "pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7"
target_path: "/var/lib/kubelet/pods/4ad3ba8c-457e-4b81-9404-b793967165b2/volumes/kubernetes.io~csi/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7/mount"
[...]
volume_context {
  key: "path"
  value: "subvol/c3/02/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7"
}
volume_context {
  key: "pvtype"
  value: "subvol"
}
[...]
volume_context {
  key: "type"
  value: "Replica3"
}
 voltype=Replica3 hostvol=replica3 pvpath=subvol/c3/02/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7 pvtype=subvol
[2021-08-11 06:51:41,769] DEBUG [nodeserver - 104:NodePublishVolume] - Mounted Hosting Volume    pv=pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7 hostvol=replica3 mntdir=/mnt/replica3
[2021-08-11 06:51:41,841] INFO [nodeserver - 113:NodePublishVolume] - Mounted PV         volume=pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7 pvpath=subvol/c3/02/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7 pvtype=subvol hostvol=replica3 duration_seconds=0.21625757217407227
```

Above all is done by `kadalu-nodeplugin` container in `kadalu-csi-nodeplugin-*` pod and so logs of that should be referred for any errors.

We can access above written `100Mfile` from below locations, please note it isn't intended to be accessed outside of app pod. Definitely not from backend bricks, if storage pool is of type `disperse` then you can't read the data directly from brick.

``` sh {linenos=table,hl_lines=[1,7,11,16,21],linenostart=1}
# From app pod 'replica3-pvc-pod'
-> kubectl exec -it replica3-pvc-pod -- sh -c 'ls -lh /mnt/replica3-pvc'
total 100M
-rw-r--r--    1 root     root      100.0M Aug 11 07:22 100Mfile

# From the node where app pod is running
-> docker exec -it k3d-test-server-0 sh -c 'ls -lh /var/lib/kubelet/pods/4ad3ba8c-457e-4b81-9404-b793967165b2/volumes/kubernetes.io~csi/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7/mount'
total 100M
-rw-r--r-- 1 0 0 100M Aug 11 07:22 100Mfile

# From nodeplugin on the node where app pod is running
-> kubectl exec -it kadalu-csi-nodeplugin-6hlw9 -c kadalu-nodeplugin -- sh -c 'ls -lh /mnt/replica3/subvol/c3/02/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7'
total 100M
-rw-r--r--. 1 root root 100M Aug 11 07:22 100Mfile

# From provisioner, all quota related operations are performed in provisioner pod
-> kubectl exec -it kadalu-csi-provisioner-0 -c kadalu-provisioner -- sh -c 'ls -lh /mnt/replica3/subvol/c3/02/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7'
total 100M
-rw-r--r--. 1 root root 100M Aug 11 07:22 100Mfile

# Lastly from any of the backend bricks, you can't read data if pool is of type `disperse`
-> kubectl exec -it server-replica3-0-0 -- sh -c 'ls -lh /bricks/replica3/data/brick/subvol/c3/02/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7'
total 100M
-rw-r--r--. 2 root root 100M Aug 11 07:22 100Mfile
```

Let's perform one last operation before looking into external gluster i.e., expand pvc from 1Gi to 2Gi

``` sh {linenos=table,hl_lines=[1,4,6,20,23,24,27],linenostart=1}
# As of now, app pod sees only 1Gi of size
-> kubectl exec -it replica3-pvc-pod -- sh -c 'df -h /mnt/replica3-pvc'
Filesystem                Size      Used Available Use% Mounted on
kadalu:replica3           1.0G    100.0M    924.0M  10% /mnt/replica3-pvc

# Just change 'storage' to 2Gi
-> bat --plain ../sample-pvc.yaml -r :13 | k apply -f -
# File: sample-pvc.yaml
---
kind: PersistentVolumeClaim
apiVersion: v1
metadata:
  name: replica3-pvc
spec:
  storageClassName: kadalu.replica3
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 2Gi
persistentvolumeclaim/replica3-pvc configured

# As the operation invovled is only manipulating quota ops, it'll be near instant
# to reflect updated 'Size' in app pod
-> kubectl exec -it replica3-pvc-pod -- sh -c 'df -h /mnt/replica3-pvc'
Filesystem                Size      Used Available Use% Mounted on
kadalu:replica3           2.0G    100.0M      1.9G   5% /mnt/replica3-pvc
```

### External Gluster

I created a one brick volume on external gluster cluster to demo kadalu capabilities. We'll be moving relatively faster as most of the ground is already covered.

``` sh {linenos=table,hl_lines=["1-4",21],linenostart=1}
# Make sure volume is started and reachable from outside the cluster
# We just need below info:
# gluster_host: 10.x.x.x
# gluster_volname: dist
-> ssh ext-gluster 'gluster volume info'

Volume Name: dist
Type: Distribute
Volume ID: 09f25449-c7d8-4904-9293-a45b848221ac
Status: Started
Snapshot Count: 0
Number of Bricks: 1
Transport-type: tcp
Bricks:
Brick1: 10.x.x.x:/bricks/brick1/dist
Options Reconfigured:
storage.fips-mode-rchecksum: on
transport.address-family: inet
nfs.disable: on

# Enable quota on gluster volume to be able to use in kadalu native format
-> ssh ext-gluster 'gluster volume quota dist enable'
volume quota : success

-> kubectl get kds,sc
NAME                                             AGE
kadalustorage.kadalu-operator.storage/replica3   4h35m

NAME                                          PROVISIONER   RECLAIMPOLICY   VOLUMEBINDINGMODE   ALLOWVOLUMEEXPANSION   AGE
storageclass.storage.k8s.io/kadalu.replica3   kadalu        Delete          Immediate           true                   4h35m

-> kubectl exec -it kadalu-csi-provisioner-0 -c kadalu-provisioner -- sh -c 'df -hT | grep kadalu'
kadalu:replica3     fuse.glusterfs   10G  307M  9.7G   3% /mnt/replica3
```

#### Pool Creation

I'll continue using the same setup as above to show the possibility of using external and internal gluster without any issues.

``` yaml {linenos=table,hl_lines=[1,2,"17-19",23,27],linenostart=1}
# We are using same CRD for both internal and external gluster, operator will validate parameters based on
# storage pool type, below is of type 'External'
-> bat --plain ../storage-config-external.yaml | tee /dev/tty | kubectl apply -f -
---
apiVersion: kadalu-operator.storage/v1alpha1
kind: KadaluStorage
metadata:
  name: ext-conf
spec:
  type: External
  details:
    gluster_host:  10.x.x.x
    gluster_volname: dist
    gluster_options: log-level=DEBUG
kadalustorage.kadalu-operator.storage/ext-conf created

# As we saw earlier, 'kadalu.' is prepended to applied CR name
# However, please note 'ALLOWVOLUMEEXPANSION' is set true, only if we are using kadalu_format as 'native'
# and an SSH key pair secret for accessing external cluster is mounted in provisioner pod
-> kubectl get kds,sc
NAME                                             AGE
kadalustorage.kadalu-operator.storage/replica3   4h37m
kadalustorage.kadalu-operator.storage/ext-conf   41s

NAME                                          PROVISIONER   RECLAIMPOLICY   VOLUMEBINDINGMODE   ALLOWVOLUMEEXPANSION   AGE
storageclass.storage.k8s.io/kadalu.replica3   kadalu        Delete          Immediate           true                   4h37m
storageclass.storage.k8s.io/kadalu.ext-conf   kadalu        Delete          Immediate           true                   36s
```

No `server` pods are created, operator just tries to connect to external gluster cluster and get the volfile, on success it fills `kadalu-info` config map to be later used in `provisioner` and `nodeplugin` pods

Below info is added to config map (trimmed existing entries in the listing)

``` json
ext-conf.info:
----
{
    "volname": "ext-conf",
    "volume_id": "19ce687a-fa8e-11eb-a07e-56a8d556e557",
    "type": "External",
    "pvReclaimPolicy": "delete",
    "kadalu_format": "native",
    "gluster_hosts": "10.x.x.x",
    "gluster_volname": "dist",
    "gluster_options": "log-level=DEBUG"
}
```

#### Volume Operations

Let's create a 1Gi PVC from 'External' storage pool and look for pv & pvc

``` yaml {linenos=table,hl_lines=[8,19,23],linenostart=1}
-> bat --plain ../sample-pvc.yaml -r 14:25 | tee /dev/tty | kubectl apply -f -
---
kind: PersistentVolumeClaim
apiVersion: v1
metadata:
  name: ext-pvc
spec:
  storageClassName: kadalu.ext-conf
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 1Gi
persistentvolumeclaim/ext-pvc created

-> kubectl get pv,pvc
NAME                                                        CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM                 STORAGECLASS      REASON   AGE
persistentvolume/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7   2Gi        RWX            Delete           Bound    kadalu/replica3-pvc   kadalu.replica3            4h3m
persistentvolume/pvc-958bcfeb-65ff-4b41-8c36-6762a0e255f8   1Gi        RWX            Delete           Bound    kadalu/ext-pvc        kadalu.ext-conf            19s

NAME                                 STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS      AGE
persistentvolumeclaim/replica3-pvc   Bound    pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7   2Gi        RWX            kadalu.replica3   4h3m
persistentvolumeclaim/ext-pvc        Bound    pvc-958bcfeb-65ff-4b41-8c36-6762a0e255f8   1Gi        RWX            kadalu.ext-conf   38s
```

Similar mounts as seen earlier will appear in `provisioner` pod when a create PVC request is fulfilled, however let's see what happens in external gluster

``` sh {linenos=table,hl_lines=[1],linenostart=1}
# Similar directory structure as discussed earlier
-> ssh ext-gluster 'ls -l /bricks/brick1/dist/'
total 20
drwxr-xr-x. 3 root root    20 Aug 11 15:54 info
-rw-r--r--. 2 root root 20480 Aug 11 15:54 stat.db
drwxr-xr-x. 3 root root    16 Aug 11 15:54 subvol

-> ssh ext-gluster 'cat /bricks/brick1/dist/info/subvol/b0/e9/pvc-958bcfeb-65ff-4b41-8c36-6762a0e255f8.json '
{"size": 1073741824, "path_prefix": "subvol/b0/e9"}

-> ssh ext-gluster 'ls -l /bricks/brick1/dist/subvol/b0/e9/pvc-958bcfeb-65ff-4b41-8c36-6762a0e255f8'
total 0
```

#### Sample App

Let's deploy a sample pod with busybox image to use 'ext-pvc'. To cut short the explanation, you can see for yourself apart from storage pool creation kadalu tries to provide similar interface for using both internally auto-managed and externally self-managed gluster cluster.

Below listings are provided to compare and contrast against previous set of operations performed.

``` yaml
-> bat --plain ../sample-app.yaml -r 23:43 | tee /dev/tty | kubectl apply -f -
---
apiVersion: v1
kind: Pod
metadata:
  name: ext-pvc-pod
spec:
  containers:
  - name: ext-pvc-pod
    image: busybox
    imagePullPolicy: IfNotPresent
    command:
      - '/bin/tail'
      - '-f'
      - '/dev/null'
    volumeMounts:
    - mountPath: '/mnt/ext-pvc'
      name: ext-pvc
  volumes:
  - name: ext-pvc
    persistentVolumeClaim:
      claimName: ext-pvc
pod/ext-pvc-pod created

-> kubectl get pods ext-pvc-pod -o wide
NAME          READY   STATUS    RESTARTS   AGE   IP           NODE               NOMINATED NODE   READINESS GATES
ext-pvc-pod   1/1     Running   0          34s   10.42.2.12   k3d-test-agent-1   <none>           <none>

-> kubectl exec -it ext-pvc-pod -- sh
/ # df -h /mnt/ext-pvc
Filesystem                Size      Used Available Use% Mounted on
10.x.x.x:dist       972.8M         0    972.8M   0% /mnt/ext-pvc
/ # cd /mnt/ext-pvc/
/mnt/ext-pvc # cat /dev/urandom | tr -dc [:space:][:print:] | head -c 100m > 100Mfile
/mnt/ext-pvc # ls -lh
total 100M
-rw-r--r--    1 root     root      100.0M Aug 11 10:34 100Mfile

-> ssh ext-gluster 'ls -lh /bricks/brick1/dist/subvol/b0/e9/pvc-958bcfeb-65ff-4b41-8c36-6762a0e255f8'
total 100M
-rw-r--r--. 2 root root 100M Aug 11 16:04 100Mfile
```

Let's expand PVC from 1Gi to 2Gi. Re-iterating the pre-requisite, PVC expansion for external storage pools can only be performed if `kadalu_format` is `native` and SSH Key pair is available for Kadalu to delegate quota operations to external gluster cluster.

``` yaml
-> bat --plain ../sample-pvc.yaml -r 14:25 | tee /dev/tty | kubectl apply -f -
---
kind: PersistentVolumeClaim
apiVersion: v1
metadata:
  name: ext-pvc
spec:
  storageClassName: kadalu.ext-conf
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 2Gi
persistentvolumeclaim/ext-pvc configured

-> kubectl exec -it ext-pvc-pod -- sh -c 'df -h | grep ext-pvc'
10.x.x.x:dist         1.9G    100.0M      1.8G   5% /mnt/ext-pvc
```

As the operations are same, the place to look for logs when things go wrong is also same in each stage. For easy reference, we can have a look at sidecar container logs as well to get a feel for how communications happen between our csi driver via csi.sock with sidecar container and kubernetes api.

## Kadalu Cleanup

We almost reached the end, let's take a step back and also look into cleaning up kadalu storage

``` sh
# Obviously, we need to delete app pods if no longer needed however PVC will stay intact
# incase app pod needs to access data again (as container restarts may happen)
-> kubectl delete pod replica3-pvc-pod ext-pvc-pod
pod "replica3-pvc-pod" deleted
pod "ext-pvc-pod" deleted

-> kubectl get sc,pvc,pv
NAME                                          PROVISIONER   RECLAIMPOLICY   VOLUMEBINDINGMODE   ALLOWVOLUMEEXPANSION   AGE
storageclass.storage.k8s.io/kadalu.replica3   kadalu        Delete          Immediate           true                   5h5m
storageclass.storage.k8s.io/kadalu.ext-conf   kadalu        Delete          Immediate           true                   21m

NAME                                 STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS      AGE
persistentvolumeclaim/replica3-pvc   Bound    pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7   2Gi        RWX            kadalu.replica3   4h22m
persistentvolumeclaim/ext-pvc        Bound    pvc-958bcfeb-65ff-4b41-8c36-6762a0e255f8   2Gi        RWX            kadalu.ext-conf   20m

NAME                                                        CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM                 STORAGECLASS      REASON   AGE
persistentvolume/pvc-dcbb7812-a5a2-402a-8ffd-2a0020a6ecc7   2Gi        RWX            Delete           Bound    kadalu/replica3-pvc   kadalu.replica3            4h22m
persistentvolume/pvc-958bcfeb-65ff-4b41-8c36-6762a0e255f8   2Gi        RWX            Delete           Bound    kadalu/ext-pvc        kadalu.ext-conf            20m
```

``` sh
# Important: If you try to delete 'kds' resource but a PVC is still being in use from a storage pool
# kubectl may state that resource is deleted but in reality, it'll not get deleted.
# We need to re-apply same storage pool config (operator reconciles state), delete any PVC and
# then storage pool can be deleted
-> kubectl delete pvc --all
persistentvolumeclaim "replica3-pvc" deleted
persistentvolumeclaim "ext-pvc" deleted
```

As a general note, if you didn't create a resource, let's say `storageClass` or `kadalu-info` config map, you shouldn't be deleting it and currently it's not always guaranteed that operator can reconcile from this state as well.

We can confirm that after deletion of PVCs, pvc directory is deleted but remember the structure is intact, we can enhance to remove the structure if no PVC is being served at the leaf directory :smile:
``` sh
-> ssh ext-gluster 'ls -R /bricks/brick1/dist'
/bricks/brick1/dist:
info
stat.db
subvol

/bricks/brick1/dist/info:
subvol

/bricks/brick1/dist/info/subvol:
b0

/bricks/brick1/dist/info/subvol/b0:
e9

/bricks/brick1/dist/info/subvol/b0/e9:

/bricks/brick1/dist/subvol:
b0

/bricks/brick1/dist/subvol/b0:
e9

/bricks/brick1/dist/subvol/b0/e9:

-> kubectl exec -t kadalu-csi-provisioner-0 -c kadalu-provisioner -- sh -c 'ls -R /mnt/replica3'
/mnt/replica3:
info
stat.db
subvol

/mnt/replica3/info:
subvol

/mnt/replica3/info/subvol:
c3

/mnt/replica3/info/subvol/c3:
02

/mnt/replica3/info/subvol/c3/02:

/mnt/replica3/subvol:
c3

/mnt/replica3/subvol/c3:
02

/mnt/replica3/subvol/c3/02:
```

We didn't delete `kds` or specific storage-pool yet and so `kadalu-info` config map still holds the details to carve another PVC if requested. Trimmed most of the data as it'll be same as before.
``` sh
# Json formatted with 'python -mjson.tool' for readability
-> kubectl describe cm kadalu-info 
Name:         kadalu-info
Namespace:    kadalu
Labels:       <none>
Annotations:  <none>

Data
====
ext-conf.info:
----
{
    "volname": "ext-conf",
    "volume_id": "19ce687a-fa8e-11eb-a07e-56a8d556e557",
    [...]
}
replica3.info:
----
{
    "namespace": "kadalu",
    "kadalu_version": "devel",
    "volname": "replica3",
    "volume_id": "5e39a614-fa66-11eb-a07e-56a8d556e557",
    "kadalu_format": "native",
    "type": "Replica3",
    "pvReclaimPolicy": "delete",
    "bricks": [
        [...]
    ],
    "disperse": {
        "data": 0,
        "redundancy": 0
    },
    "options": {}
}

uid:
----
f6689df0-c4e3-4ecb-a9d4-d788f0edd487
volumes:
----

Events:  <none>
```

When we delete `kds` (storage pool) as well then we are left with resources deployed from operator and csi-nodeplugin alone.

``` sh
-> kubectl delete kds --all
kadalustorage.kadalu-operator.storage "replica3" deleted
kadalustorage.kadalu-operator.storage "ext-conf" deleted

-> kubectl get all
NAME                              READY   STATUS    RESTARTS   AGE
pod/operator-88bd4784c-4ldbv      1/1     Running   0          5h23m
pod/kadalu-csi-provisioner-0      5/5     Running   0          5h23m
pod/kadalu-csi-nodeplugin-pzbf7   3/3     Running   0          5h22m
pod/kadalu-csi-nodeplugin-chc7d   3/3     Running   0          5h22m
pod/kadalu-csi-nodeplugin-lf5ml   3/3     Running   0          5h22m
pod/kadalu-csi-nodeplugin-6hlw9   3/3     Running   0          5h22m

NAME                                   DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE
daemonset.apps/kadalu-csi-nodeplugin   4         4         4       4            4           <none>          5h22m

NAME                       READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/operator   1/1     1            1           5h23m

NAME                                 DESIRED   CURRENT   READY   AGE
replicaset.apps/operator-88bd4784c   1         1         1       5h23m

NAME                                      READY   AGE
statefulset.apps/kadalu-csi-provisioner   1/1     5h23m

-> kubectl describe cm kadalu-info 
Name:         kadalu-info
Namespace:    kadalu
Labels:       <none>
Annotations:  <none>

Data
====
uid:
----
f6689df0-c4e3-4ecb-a9d4-d788f0edd487
volumes:
----

Events:  <none>
```

Supply manifests which deployed csi-nodeplugin, operator and all dependent RBAC roles etc for deleting them as below

``` sh
-> curl -s https://raw.githubusercontent.com/kadalu/kadalu/devel/manifests/csi-nodeplugin.yaml | sed 's/"no"/"yes"/' | kubectl delete -f -
clusterrole.rbac.authorization.k8s.io "kadalu-csi-nodeplugin" deleted
clusterrolebinding.rbac.authorization.k8s.io "kadalu-csi-nodeplugin" deleted
daemonset.apps "kadalu-csi-nodeplugin" deleted

-> curl -s https://raw.githubusercontent.com/kadalu/kadalu/devel/manifests/kadalu-operator.yaml | sed 's/"no"/"yes"/' | kubectl delete -f -
namespace "kadalu" deleted
serviceaccount "kadalu-operator" deleted
serviceaccount "kadalu-csi-nodeplugin" deleted
serviceaccount "kadalu-csi-provisioner" deleted
serviceaccount "kadalu-server-sa" deleted
customresourcedefinition.apiextensions.k8s.io "kadalustorages.kadalu-operator.storage" deleted
clusterrole.rbac.authorization.k8s.io "pod-exec" deleted
clusterrole.rbac.authorization.k8s.io "kadalu-operator" deleted
clusterrolebinding.rbac.authorization.k8s.io "kadalu-operator" deleted
deployment.apps "operator" deleted
```

Finally, if we don't want a staged cluster cleanup (or) cluster state is inconsistent and no fixes are found, we can apply below cleanup script after deleting app pods in `kadalu` namespace if there are any.
``` sh
-> curl -s https://raw.githubusercontent.com/kadalu/kadalu/devel/extras/scripts/cleanup | bash
Error from server (NotFound): statefulsets.apps "kadalu-csi-provisioner" not found
[...]
Error from server (NotFound): namespaces "kadalu" not found
```

## Miscellaneous

We only covered general usecase(s) upto now and there are other specialized features (considering whole kadalu project) which comes handy if needed, below just mentions about them. Please refer docs or raise an [issue](http://github.com/kadalu/kadalu/issues) for more info.
1. Decommissioning of storage pool bricks
2. Re-creating storage pool based on volume id
3. Migration from Heketi (in progress)

If you are willing to contribute to the project, below are some of the ideas to get you started:
1. Usage of internal gluster outside of CSI as a general NAS solution
2. Enabling CSI Snapshots
3. Support for SMB and windows workloads
4. Support for `volumeMode: Block`
5. Enhance CI infra
6. Enhance Prometheus monitoring

Unlike previous posts I intentionally left out debugging/code walk through as it may not be of particular interest from a user/admin perspective. However, please reach out by any means (or simply comment here) for more info.

## Summary

Let's recap what we've have discussed so far and I hope you'll be better equipped to approach some of the CSI solutions after a couple of reads of this post.

1. Operator responds to events on kadalustorages CRD
2. Captures the required info into `kadalu-info` config map
3. Bring up `server` pods or connect to external gluster if required and write directory structure on brick
4. All containers which require volfiles will fill pre-made jinja templates with `kadalu-info` or ask for volfile incase of external gluster and starts brick/mount process
5. Sidercars in CSI pods will be listening to api-server and delegates requests to already deployed CSI pods
6. Based on the invoked gRPC call, process running in CSI pods fulfills the request

And this brings a closure to the series `Exploring Kadalu Storage` unless something exciting happens or I get any new requests to blog around kadalu specifics.

