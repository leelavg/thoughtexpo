---
title: "Exploring Kadalu Storage in k3d Cluster - CSI Driver"
date: 2021-03-25T13:08:48+05:30
tags: ["kubernetes", "kadalu", "csi"]
draft: false
---

In the [previous](https://thoughtexpo.com/setup-k3d-cluster-for-local-testing-or-development/) article we setup a `k3d` cluster and discussed about a typical workflow. We'll be utilising earlier concepts and deploy a [CSI Driver](https://kubernetes-csi.github.io/docs/introduction.html) on the `k3d` cluster, perform minimal operations while exploring Kadalu storage as Persistence Storage via CSI.

Even though I'll be concentrating on the Kadalu CSI Driver component in current blog post, in itself has many moving parts. Due to that, I'll be making cross references than re-iterating the details and add extra context only when it's needed. On that note, let's get started.

## Introduction

In short, [kadalu](https://kadalu.io/) is a/an:
- [Open Source Project/Organization](https://github.com/kadalu/) providing tools around [gluster](https://www.gluster.org/) filesystem
- [Storage Provider](https://github.com/kadalu/kadalu/) (SP) compatible with CSI
- Kubernetes (CO) Operator managing [gluster](https://github.com/kadalu/glusterfs/tree/series_1) in kubernetes
- CSI Driver interacting with SP and CO
> Kadalu storage can be published to various Container Orchestrators (Kubernetes, RKE, OpenShift, Microk8s)

If you have a running Kubernetes cluster and want to deploy Kadalu storage please refer [quick-start](https://kadalu.io/docs/k8s-storage/latest/quick-start) from the docs. However, this blog post deals with local testing/development with `k3d` and it's a bit involving when deploying any CSI storage on a docker based environment alone, so please follow along.

You can use one of devices or directory path or persistent volumes to act as an underlying storage for gluster. We'll reserve all minute details around Operator and Gluster storage in containers for a later post and concentrate on CSI Driver for now.

If you are feeling adventurous and just want a script to setup and teardown k3d cluster with kadalu storage please refer [this](https://github.com/leelavg/forge/blob/master/adhoc/k3d-kadalu.sh) script but it carries a huge disclaimer that do not run without checking what it does or else your devices (`sdc, sdd, sde`) will get formatted. :warning:

> Kindly raise a [github issue](https://github.com/kadalu/kadalu/issues) if any of the processes stated here resulting in an error

## Kadalu in k3d cluster

Storage systems in Kubernetes need a [bi-directional mount](https://kubernetes.io/docs/concepts/storage/volumes/#mount-propagation) to the underlying host and in our case we need to have a shared directory (for storing secret tokens) with k3d mapping to host system as well.

Please create cluster with below commands, I strongly recommend going through [previous](https://thoughtexpo.com/setup-k3d-cluster-for-local-testing-or-development/#optimizing-workflow) article to get to know about local container registry, importing images into k3d cluster etc.:

``` sh
# I'll be using below directories for gluster storage
-> df -h | grep /mnt
/dev/sdc                             10G  104M  9.9G   2% /mnt/sdc
/dev/sdd                             10G  104M  9.9G   2% /mnt/sdd
/dev/sde                             10G  104M  9.9G   2% /mnt/sde

# Make a dir to be used for shared mount
-> mkdir -p /tmp/k3d/kubelet/pods

# My local registry (optional, if not used remove corresponding arg while creating the cluster)
-> bat ~/.k3d/registries.yaml  --plain
mirrors:
  "registry.localhost:5000":
    endpoint:
      - "http://registry.localhost:5000"

# Create a k3d cluster with volume mounts and local registry
-> k3d cluster create test -a 3 -v /tmp/k3d/kubelet/pods:/var/lib/kubelet/pods:shared \
-v /mnt/sdc:/mnt/sdc -v /mnt/sdd:/mnt/sdd -v /mnt/sde:/mnt/sde \
-v ~/.k3d/registries.yaml:/etc/rancher/k3s/registries.yaml
[...]
INFO[0000] Created volume 'k3d-test-images'
INFO[0001] Creating node 'k3d-test-server-0'
[...]
INFO[0044] Starting helpers...
INFO[0044] Starting Node 'k3d-test-serverlb'
[...]
kubectl cluster-info

# Deploy kadalu operator with setting 'verbose' to 'yes'
-> curl -s https://raw.githubusercontent.com/kadalu/kadalu/devel/manifests/kadalu-operator.yaml \
| sed 's/"no"/"yes"/' | kubectl apply -f -
```


Once kadalu operator is deployed it reconciles the state as per config and deploys `nodeplugin` as `daemonset`,`provisioner` (~controller) as `statefulset` and watches CRD for creating kadalu storage among others.

Things to take note of:
1. You can refer above stated script for importing local docker images into k3d cluster before deploying the operator.
2. For installing operator through helm please refer [github](https://github.com/kadalu/kadalu/#helm-support)
3. At the time of this writing, `HEAD` on `devel` branch is at commit [9fe6ad4](https://github.com/kadalu/kadalu/tree/9fe6ad41afa439908e7df6da07858dc743a3ed8a)

Verify all the pods are deployed and are in running state in kadalu namespace. You can install [kubectx and kubens](https://github.com/ahmetb/kubectx) for easy navigation across contexts and namespaces.
``` sh
-> kubectl get pods -n kadalu -o wide
NAME                          READY   STATUS    RESTARTS   AGE   IP          NODE                NOMINATED NODE   READINESS GATES
operator-88bd4784c-bkzlt      1/1     Running   0          23m   10.42.0.5   k3d-test-server-0   <none>           <none>
kadalu-csi-nodeplugin-8ttmk   3/3     Running   0          23m   10.42.3.3   k3d-test-agent-2    <none>           <none>
kadalu-csi-nodeplugin-fv57x   3/3     Running   0          23m   10.42.1.5   k3d-test-agent-0    <none>           <none>
kadalu-csi-nodeplugin-ngfm2   3/3     Running   0          23m   10.42.2.4   k3d-test-agent-1    <none>           <none>
kadalu-csi-nodeplugin-7qwhm   3/3     Running   0          23m   10.42.0.6   k3d-test-server-0   <none>           <none>
kadalu-csi-provisioner-0      5/5     Running   0          23m   10.42.3.4   k3d-test-agent-2    <none>           <none>

# Using mounted volumes for creating storage pool
-> bat ../storage-config-path.yaml --plain; kubectl apply -f ../storage-config-path.yaml
---
apiVersion: kadalu-operator.storage/v1alpha1
kind: KadaluStorage
metadata:
  name: replica3
spec:
  type: Replica3
  storage:
    - node: k3d-test-agent-0
      path: /mnt/sdc
    - node: k3d-test-agent-1
      path: /mnt/sdd
    - node: k3d-test-agent-2
      path: /mnt/sde
kadalustorage.kadalu-operator.storage/replica3 created

# Verify server pods are up and running
-> kubectl get pods -l app.kubernetes.io/component=server
NAME                  READY   STATUS    RESTARTS   AGE
server-replica3-1-0   1/1     Running   0          4m28s
server-replica3-2-0   1/1     Running   0          4m27s
server-replica3-0-0   1/1     Running   0          4m29s
```
The end, you can follow [official docs](https://kadalu.io/docs/k8s-storage/latest/quick-start) for creating pv, pvs from above created `kadalu.replica3` storage class and use them in app pods and comfortably skip what follows next or continue if you want to know about debugging Kadalu CSI Driver (or running a debug container in general).

## Debugging Kadalu CSI Driver

I read a couple of blog posts discussing about debugging a (python) application running in a container however they didn't fit my needs well (either they are editor dependent or time taking :confused:).

I'm not saying the methods shared here are superior however they are making my workflow a tad bit easier rather than making changes to source code, committing the docker container and re-deploying cycle or running a server accessible to editor and debugging the code.

We have one server (master) and three agents (worker) in our `k3d` cluster, to ease the things you can get away with running a single server node and debug your application. However, I'm more interested in 
simulating a user environment as much as possible and so is the distributed nature of the environment.

### Prerequisite (or Good to know info)

About CSI volume plugin & driver implementation:
- Please refer [this great article](https://arslan.io/2018/06/21/how-to-write-a-container-storage-interface-csi-plugin/) about building a CSI Plugin which summarizes [CSI Design Proposal](https://github.com/kubernetes/community/blob/master/contributors/design-proposals/storage/container-storage-interface.md) and [CSI Spec](https://github.com/container-storage-interface/spec/blob/master/spec.md) succinctly
- (All are optional assuming some degree of knowledge on these) [Protobuf Python tutorial](https://developers.google.com/protocol-buffers/docs/pythontutorial), [GRPC Python tutorial](https://grpc.io/docs/languages/python/basics/) and [GRPC status codes](https://grpc.github.io/grpc/core/md_doc_statuscodes.html)

About Python debugger:
- Starting from Python v3.7, we can pause the execution and drop into debugger using the function `breakpoint()` more from the [docs](https://docs.python.org/3/library/functions.html#breakpoint)
- More on using breakpoint feature you can refer [this blog post](https://www.askpython.com/python/built-in-methods/python-breakpoint-function) as well
- Possible ways of attaching a debugger to a running process from a [SO answer](https://stackoverflow.com/a/25329467), however the gist is, we can't attach debugger to running python process without restarting or having a singal handler in the source

About Kubectl `cp` and `port-forward`:
- Kubectl has functionality for copying files to and from containers, more from the [docs](https://kubernetes.io/docs/reference/generated/kubectl/kubectl-commands#cp)
- We can forward a containers port directly using `port-forward` functionality rather than using Service resource (not recommended for any prod deployments), refer [docs](https://kubernetes.io/docs/reference/generated/kubectl/kubectl-commands#port-forward) for reference

Miscellaneous:
- [socat](https://www.cyberciti.biz/faq/linux-unix-tcp-port-forwarding/): Utility which can expose a Unix Domain Socket (UDS) over tcp, you can refer [this Dockerfile](https://github.com/kadalu/kadalu/blob/devel/tests/test-csi/sanity-debug.yaml) for running socat in a pod and exposing CSI UDS connection over tcp
- Definitely check out [csi-sanity](https://github.com/kubernetes-csi/csi-test/tree/master/cmd/csi-sanity) to verify whether a CSI Driver is conforming to spec or not and refer [this article](https://kubernetes.io/blog/2020/01/08/testing-of-csi-drivers/) for more on testing CSI Volume Drivers
- [Container Storage Client](https://github.com/rexray/gocsi/tree/master/csc) (csc): A CLI client with CSI RPCs implemented to talk with a CSI endpoint via tcp or UDS
- [gRPCurl](https://github.com/fullstorydev/grpcurl): Optional but a great addition if you want to communicate with any gRPC server 

Alright, as we got hold of the basics, on to the problem statement, implementation and debugging code.

> **Note:** I can't possibly go through every minute detail, please [reach out](https://twitter.com/leela_vg) to me for more info or start a discussion in comments section.

### Problem Statement
- We have an unimplemented RPC method `ListVolumes` which is a part of `Controller` service, usually this method is invoked by [External Health Monitor Controller](https://kubernetes-csi.github.io/docs/volume-health-monitor.html)
- Currently we are not using `external-health-monitor-controller` sidecar to test this feature even if we implement and need to call this method manually

I've created a PVC and mounted it in a container, we just need to return PVC Volume name with the minimum required fields as per the proto definition to satisfy `ListVolumes` RPC
``` sh
# PVC which is hosted on above created Kadalu Replica3 storage class
-> kubectl get pvc
NAME    STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS      AGE
pvc2g   Bound    pvc-02072076-468a-43b2-bf40-b33ae6978e19   2Gi        RWX            kadalu.replica3   23h

# Pod which is currently using `pvc2g` claim
-> kubectl describe pvc pvc2g | grep Used
Used By:       pod1
```
Not that it's tough to implement, just not to lengthen this article we'll cutomize our RPC client call to return all the volumes without tokenizing. Before proceeding with implemention, knowing about how Kadalu storage provisions PVC would be helpful.
- Kadalu creates a normal Gluster volume out of the bricks/paths provided above and creates a PVC directory on it
- Using the Gluster subdir functionality, CSI Driver only mounts PVC directory into the container upon receiving `NodePublishVolume` and sets and updates quota not to spill over then capacity received as part of the initial request

### Typical Implementation
Note that most if not all of the RPC calls should be idempotent and all the methods that implement them internally should try to reach to required state or log and fail with error.

One of the [commits](https://github.com/kadalu/kadalu/pull/432) de-coupled the code at the process level which enabled the separation of concerns with monitoring state and reconciling the process to required state without which steps followed in the rest of the article will not be possible.

Before we proceed further, let's invoke `ListVolumes` method with no code change and then arrive at the solution. We'll deploy `socat` pod as a `daemonset` on all `k3d` agents which exposes CSI UDS as tcp connection and use `csc` to connect to the tcp port.

As provisioner pod uses an `emptyDir` we need to access that differently and use a `deployment` with `1 replica` and schedule that on node where `provisioner` pod is deployed.

> **Important:** The beauty of one of the recommended approaches packaging all services in a single binary we can get away with not having extra deployment on `provisioner` pod's node. The downside is, when we access Controller Services the log messages end up in Node Service Pods. For brevity, I'm using separate pod for accessing provisioner `csi.sock` file.

A [pod manifest](https://github.com/kadalu/kadalu/blob/devel/tests/test-csi/sanity-debug.yaml) exists in the repo however below is a modified form:

``` yaml {linenos=table}
-> bat tests/test-csi/sanity-debug.yaml --plain
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  namespace: kadalu
  name: sanity-ds
  labels:
    name: sanity-ds
spec:
  selector:
    matchLabels:
      name: sanity-ds
  template:
    metadata:
      labels:
        name: sanity-ds
    spec:
      containers:
        - name: socat
          image: alpine/socat:1.0.5
          args:
            - tcp-listen:10000,fork,reuseaddr
            - unix-connect:/plugin/csi.sock
          volumeMounts:
            - name: csi-sock
              mountPath: /plugin/csi.sock
      volumes:
        - name: csi-sock
          hostPath:
            path: /var/lib/kubelet/plugins_registry/kadalu/csi.sock
            type: Socket
---
apiVersion: apps/v1
kind: Deployment
metadata:
  namespace: kadalu
  name: sanity-dp
  labels:
    name: sanity-dp
spec:
  replicas: 1
  selector:
    matchLabels:
      name: sanity-dp
  template:
    metadata:
      labels:
        name: sanity-dp
    spec:
      affinity:
        podAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchExpressions:
              - key: app.kubernetes.io/name
                operator: In
                values:
                - kadalu-csi-provisioner
            topologyKey: "kubernetes.io/hostname"
      containers:
        - name: socat
          image: alpine/socat:1.0.5
          args:
            - tcp-listen:10001,fork,reuseaddr
            - unix-connect:/plugin/csi.sock
          volumeMounts:
            - name: csi-sock
              mountPath: /plugin/csi.sock
      volumes:
        - name: csi-sock
          hostPath:
            # UID of the POD should be replaced before deployment
            path: '/var/lib/kubelet/pods/POD_UID/volumes/kubernetes.io~empty-dir/socket-dir/csi.sock'
            type: Socket
```

Deploying pods after replacing `POD_UID` in the yaml manifest
``` sh {linenos=table,hl_lines=[20,21],linenostart=1}
# Store Provisioner Pod UID
-> POD_UID=$(kubectl get pods kadalu-csi-provisioner-0 -o jsonpath={'.metadata.uid'})

# Applying and verifying the manifest
-> sed "s/POD_UID/$POD_UID/" tests/test-csi/sanity-debug.yaml | kubectl apply -f -
daemonset.apps/sanity-ds created
deployment.apps/sanity-dp created

# Pods after reaching Ready state (Sanitized output)
-> kubectl get pods --sort-by='{.spec.nodeName}' \
-o=custom-columns='NAME:.metadata.name,NODE:.spec.nodeName' | grep -P 'sanity|csi|NODE'
NAME                          NODE
kadalu-csi-nodeplugin-fv57x   k3d-test-agent-0
sanity-ds-6mxxc               k3d-test-agent-0

sanity-ds-qtz6d               k3d-test-agent-1
kadalu-csi-nodeplugin-ngfm2   k3d-test-agent-1

sanity-ds-z6f5s               k3d-test-agent-2
kadalu-csi-provisioner-0      k3d-test-agent-2
sanity-dp-67cc596d6c-xknf7    k3d-test-agent-2
kadalu-csi-nodeplugin-8ttmk   k3d-test-agent-2

sanity-ds-2khrd               k3d-test-server-0
kadalu-csi-nodeplugin-7qwhm   k3d-test-server-0
```

You can see from above output that we can have access to `csi.sock` from every `k3d` node exposed via `sanity` pod on port `10000` (`10001` for accessing Controller Server). All we have to do is `port-foward` exposed port and access it with [`csc`](https://github.com/rexray/gocsi/tree/master/csc).

Here we are `port-forward`'ing from pod `sanity-dp-67cc596d6c-xknf7` so that we can talk with `controller` service deployed on `kadalu-csi-provisioner-0` pod.
``` sh
# In one pane, run a 'kubectl port-forward'
-> kubectl port-forward pods/sanity-dp-67cc596d6c-xknf7 :10001
Forwarding from 127.0.0.1:41289 -> 10001
Forwarding from [::1]:41289 -> 10001

# In another pane, run `ncat` to keep above port-fowarding alive
-> while true; do nc -vz 127.0.0.1 41289 ; sleep 15 ; done

# Another pane, finally we can access tcp connection to talk with our CSI Controller server
-> csc identity plugin-info -e tcp://127.0.0.1:41289
"kadalu"        "devel"

-> csc controller get-capabilities -e tcp://127.0.0.1:41289
&{type:CREATE_DELETE_VOLUME }
&{type:LIST_VOLUMES }
&{type:EXPAND_VOLUME }

# What we want to implement
-> csc controller list-volumes -e tcp://127.0.0.1:41289
Failed to serialize response

Please use -h,--help for more information

# Logs from provisioner when above is run
-> kubectl logs kadalu-csi-provisioner-0 kadalu-provisioner | tail
[2021-03-25 07:09:53,332] ERROR [_common - 88:_transform] - Exception serializing message!
Traceback (most recent call last):
  File "/kadalu/lib/python3.8/site-packages/grpc/_common.py", line 86, in _transform
    return transformer(message)
TypeError: descriptor 'SerializeToString' for 'google.protobuf.pyext._message.CMessage' objects doesn't apply to a 'NoneType' object
```

Couple of points to take note of above:
- We can change the `csi.sock` path in `daemon-set`/`deployment` manifest to be able to use above method in any CSI Driver accordingly
- We can use `secrets` if the CSI Driver (/underlying storage) supports it for calling RPC methods
- We haven't yet dealt with changing/adding code snippets to src files in the container and test them
- We either have a bug in `csc` that's not able to parse the response or the response is malformed from CSI driver. Either ways we'll implement this function and review the results (sneak peak, the bug is in Driver)

> **Note:** By the time you read this post, the bug may be fixed however our main aim for this post is about the process of debugging CSI Driver

I cloned [Kadalu repo](https://github.com/kadalu/kadalu/) and implemented a **quick and dirty** method definition for `ListVolumes` and below is the code snippet:
``` python {linenos=table,linenostart=1}
# csi/controllerserver.py
# ...
def ListVolumes(self, request, context):
    # Return list of all volumes (pvc's) in every hostvol

    errmsg = ''
    pvcs = []

    try:
        # Mount hostvol, walk through directories and return pvcs
        for volume in get_pv_hosting_volumes({}):
            hvol = volume['name']
            mntdir = os.path.join(HOSTVOL_MOUNTDIR, hvol)
            mount_glusterfs(volume, mntdir)
            json_files = glob.glob(os.path.join(mntdir, 'info', '**',
                                                '*.json'),
                                    recursive=True)
            pvcs.extend([
                name[name.find('pvc'):name.find('.json')]
                for name in json_files
            ])
    except Exception as excep:
        errrmsg = str(excep)

    if not pvcs or errmsg:
        errmsg = errmsg or "Unable to find pvcs"
        logging.error("ERROR: %s", errmsg)
        context.set_details(errmsg)
        context.set_code(grpc.StatusCode.NOT_FOUND)
        return csi_pb2.ListVolumesResponse()

    logging.info(logf("Got list of volumes", pvcs=pvcs))
    return csi_pb2.ListVolumesResponse(entries=[{
        "volume": {
            "volume_id": pvc
        }
    } for pvc in pvcs])
# ...
```

### Debugging or testing the changes

Now that we have the method implemented we will copy the corresponding src file into container, kill `main.py` (which registers all CSI services) and reconciler (`start.py`) monitors/observes the process absense then it'll run `main.py` as subprocess which'll run our modified python src file.

``` sh {linenos=table,hl_lines=[7,22],linenostart=1}
# Copy the src file into kadalu-provisioner
-> kubectl cp csi/controllerserver.py kadalu-csi-provisioner-0:/kadalu/controllerserver.py -c kadalu-provisioner

# Processes running in provisioner container
-> kubectl exec -it kadalu-csi-provisioner-0 -c kadalu-provisioner -- sh -c 'ps -ef | grep python'
root           1       0  0 Mar23 ?        00:00:24 python3 /kadalu/start.py
root           8       1  0 Mar23 ?        00:01:13 python3 /kadalu/main.py
root           9       1  0 Mar23 ?        00:00:32 python3 /kadalu/exporter.py
root      246800       0  0 10:33 pts/3    00:00:00 sh -c ps -ef | grep python
root      246808  246800  0 10:33 pts/3    00:00:00 grep python

# Init process is `start.py` and it runs `main.py` and `exporter.py` as subprocess
# monitors and tries it's best to keep them running.
# Killing `main.py` will be singalled to `start.py` and will be re-run again
-> kubeclt exec -it kadalu-csi-provisioner-0 -c kadalu-provisioner -- sh -c 'kill 8'

# `main.py` is run again and got a PID 246855, as methods from `csi/controllerserver.py` is
# imported in `main.py` it'll call above modified method
-> kubectl exec -it kadalu-csi-provisioner-0 -c kadalu-provisioner -- sh -c 'ps -ef | grep python'
root           1       0  0 Mar23 ?        00:00:24 python3 /kadalu/start.py
root           9       1  0 Mar23 ?        00:00:32 python3 /kadalu/exporter.py
root      246855       1  3 10:33 ?        00:00:00 python3 /kadalu/main.py
root      246897       0  0 10:33 pts/3    00:00:00 sh -c ps -ef | grep python
root      246904  246897  0 10:33 pts/3    00:00:00 grep python
```

If in a hurry you call the `csc` client again to `ListVolumes` using the same tcp port, you'll be treated with a `Connection Closed` message (cause it's actually closed upon killing process)
```sh
-> csc identity plugin-info -e tcp://127.0.0.1:41289
connection closed

Please use -h,--help for more information
```
As we have deployed `socat` pods using `deployment` and `daemonset` kind we can delete the pod to be presented a new tcp connection at the worst case or we can perform the same (`port-foward` and `nc`) before using `csc` again
```sh {linenos=table,hl_lines=[3,8,21],linenostart=1}
# Tada! I did get it correct in first try itself :)
-> csc controller list-volumes -e tcp://127.0.0.1:46171
"pvc-02072076-468a-43b2-bf40-b33ae6978e19"      0

# Validation
-> kubectl get pvc
NAME    STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS      AGE
pvc2g   Bound    pvc-02072076-468a-43b2-bf40-b33ae6978e19   2Gi        RWX            kadalu.replica3   32h

# Logs from provisioner upon calling above RPC method
-> k logs kadalu-csi-provisioner-0 kadalu-provisioner | tail
TypeError: descriptor 'SerializeToString' for 'google.protobuf.pyext._message.CMessage' objects doesn't apply to a 'NoneType' object
Latest consumption on /mnt/replica3/subvol/9a/3a/pvc-02072076-468a-43b2-bf40-b33ae6978e19 : 0
Latest consumption on /mnt/replica3/subvol/9a/3a/pvc-02072076-468a-43b2-bf40-b33ae6978e19 : 0
Latest consumption on /mnt/replica3/subvol/9a/3a/pvc-02072076-468a-43b2-bf40-b33ae6978e19 : 0
[2021-03-25 10:33:39,051] INFO [kadalulib - 369:monitor_proc] - Restarted Process        name=csi
[2021-03-25 10:33:39,403] DEBUG [volumeutils - 812:mount_glusterfs] - Already mounted    mount=/mnt/replica3
[2021-03-25 10:33:39,404] INFO [main - 36:mount_storage] - Volume is mounted successfully        hvol=replica3
[2021-03-25 10:33:39,417] INFO [main - 56:main] - Server started
[2021-03-25 10:36:37,664] DEBUG [volumeutils - 812:mount_glusterfs] - Already mounted    mount=/mnt/replica3
[2021-03-25 10:36:37,709] INFO [controllerserver - 345:ListVolumes] - Got list of volumes        pvcs=['pvc-02072076-468a-43b2-bf40-b33ae6978e19']
```

Unfortunately, setting a `breakpoint()` in a grpc context results in `bdb.BdbQuit` error when attached to TTY of the container. We'll go through using `breakpoint()` feature in subsequent posts which supports it and below is the brief process:
1. Wherever we want to pause the execution just introduce `breakpoint()` function in the src file and perform `cp`, restart of `socat` pod and perform the operation which triggers the breakpoint
2. The execution will be paused at breakpoint and attach the container from `daemonset`/`statefulsets`/`deployments` kinds using command similar to 
```sh
# Target can be 'ds'/'sts'/deploy' kinds
-> kubectl attach sts/kadalu-csi-provisioner -c kadalu-provisioner -it
Unable to use a TTY - container kadalu-provisioner did not allocate one
If you don't see a command prompt, try pressing enter.

[...]
```

If we want to test/kill `main.py` which is the `init` process, container itself will be killed and replaced with a new pod, so the modified code will not come into effect.

In such cases we need to (docker) commit the container after `cp` of the code blocks, retag and push to the local registry (remember `k3d` cluster can access local registry) and change/edit/patch the image source in yaml manifests. (We'll go through this scenario as well in later posts :smiley:)

### Caveats and tips
- If you don't have a busy system you can assign a static port in `kubectl port-forward` command and register the PORT as the environment variable to re-use everytime
- It goes without saying, the above said process will be super simple if we are developing/debugging changes in a single node cluster
- It's not always easy to change, `cp` file and restart the tcp connection, you can configure an alias for easy of use
- Not all cases can be debuggable however with some effort we can change the workflow to our needs
- Better logging systems is hardly replaceable in any code base and should be the first place to look on hitting any issues

## Summary
If you give a couple of reads you can easily derive below gist:
- Create a `k3d` cluster and deploy `kadalu` operator which'll pull all the necessary images and creates pods/containers needed to serve storage
- Refer/create newly available storage in your PVC manifests and mount the PV in the pod/container
- For debugging CSI Volume Driver, get a hold of `csi.sock` file and expose that as a tcp connection (via Socat), access that tcp connection with `csc`
- Change the src code and `cp` the file to container, restart the socat pods and communicate via `csc` client for debugging grpc methods

Cleanup of the cluster:
If you have followed previous article and current post, you can delete entire `k3d` cluster without any trace by following below steps:
- First, delete all the `daemonsets`/`deployments` which aren't created by `kadalu` operator
- Run the [provided](https://github.com/kadalu/kadalu/blob/devel/extras/scripts/cleanup) cleanup script `bash <(curl -s https://raw.githubusercontent.com/kadalu/kadalu/devel/extras/scripts/cleanup)` to delete all `kadalu` components
- Delete `k3d` cluster by running `-> k3d cluster delete test`
- Due to the usage of shared directories there'll be some left overs mounted even after cluster deletion, when you create a new cluster these directories will be masked and new mounts happen leaving a lot of unwanted entries, take a diff after cluster deletion, unmount whichever isn't mounted after the end of cluster deletion by running:
``` sh
-> diff <(df -ha | grep pods | awk '{print $NF}') <(df -h | grep pods | awk '{print $NF}') \
| awk '{print $2}' | xargs umount -l

# Some housekeeping for docker (Don't run these without knowing what they do)
-> docker rmi $(docker images -f "dangling=true" -q)
-> docker volume prune -f
-> docker volume rm $(docker volume ls -qf dangling=true)
```

As stated earlier script for setup and teardon of `k3d` cluster is available [here](https://github.com/leelavg/forge/blob/master/adhoc/k3d-kadalu.sh), you have been warned, don't run without checking it.

It may seem that we have covered a lot of ground but I had to intentionally drop off some excerpts. I'll be continuing with exploring another component of Kadalu storage in later posts and add any points missed in current post. Stay tuned :eyes:
